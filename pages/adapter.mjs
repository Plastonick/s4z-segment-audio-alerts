const finite = (x) => typeof x === 'number' && Number.isFinite(x);
const identity = (x) => String(x);

export function createAdapter(common) {
  const names = new Map();
  async function segmentNames(ids) {
    const missing = [...new Set(ids.map(identity))].filter((x) => !names.has(x));
    if (missing.length) {
      try {
        // Sauce metadata uses numeric IDs.
        const raw = missing.map((id) => ids.find((x) => identity(x) === id));
        for (const segment of await common.getSegments(raw)) {
          if (segment?.id != null && segment.name) names.set(identity(segment.id), segment.name);
        }
      } catch {
        /* Use segment IDs as names. */
      }
    }
    return (id) => names.get(identity(id)) || `Segment ${id}`;
  }
  async function locate(state) {
    let route;
    let routeId = state.routeId;
    try {
      const subgroup = await common.getEventSubgroup(state.eventSubgroupId);
      routeId = subgroup?.routeId || routeId;
      if (routeId && finite(state.routeDistance)) route = await common.getRoute(routeId);
    } catch {
      /* Fall back to the current road. */
    }
    if (route && Array.isArray(route.segments)) {
      const prelude = state.laps ? route.meta?.weldDistance : route.meta?.leadinDistance;
      if (finite(prelude))
        return {
          segments: route.segments,
          position: state.routeDistance - prelude,
          context: `route:${routeId}:lap:${state.laps || 0}`,
          mode: 'Route preview',
        };
    }
    const road = await common.getRoad(state.courseId, state.roadId);
    if (!road?.curvePath || !Array.isArray(road.segments) || !finite(state.roadTime))
      throw new Error('No road metadata');
    let position = road.curvePath.distanceAtRoadTime(state.roadTime) / 100;
    if (state.reverse) position = road.distances.at(-1) - position;
    if (!finite(position)) throw new Error('No road position');
    return {
      segments: road.segments.filter((x) => !!x.reverse === !!state.reverse),
      position,
      context: `road:${state.courseId}:${state.roadId}:${!!state.reverse}`,
      mode: 'Current road preview',
    };
  }
  return async function adapt(data) {
    if (!data?.state || !Array.isArray(data.segments))
      throw new Error('Waiting for rider data with segment support');
    const s = data.state;
    if (!finite(s.worldTime) || data.athleteId == null || data.created == null)
      throw new Error('Unsupported rider data: missing session or timestamp');
    let location = {
      segments: [],
      context: null,
      position: null,
      mode: 'Start/finish only — preview metadata unavailable',
    };
    try {
      location = await locate(s);
    } catch {
      /* Keep start/finish detection. */
    }
    const name = await segmentNames([
      ...data.segments.map((x) => x.segmentId),
      ...location.segments.map((x) => x.id),
    ]);
    const attempts = data.segments
      .filter((x) => x.id != null && x.segmentId != null && typeof x.active === 'boolean')
      .map((x) => ({
        key: String(x.id),
        active: x.active,
        incomplete: !!x.incomplete,
        name: name(x.segmentId),
      }));
    return {
      session: JSON.stringify([data.athleteId, data.created, s.courseId]),
      time: s.worldTime,
      age: data.age,
      speed: s.speed / 3.6,
      attempts,
      context: location.context,
      position: location.position,
      mode: location.mode,
      upcoming: location.segments
        .filter((x) => finite(x.offset) && finite(x.distance) && x.offset > location.position)
        .map((x) => ({
          key: `${x.id}:${x.offset}`,
          name: name(x.id),
          toStart: x.offset - location.position,
        }))
        .sort((a, b) => a.toStart - b.toStart),
    };
  };
}
