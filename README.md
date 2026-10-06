# Segment audio alerts

Sauce for Zwift mod with configurable advance speech/beeps and start/finish tones.

## Use

Copy this folder to `~/Documents/SauceMods/segment-alerts`, restart Sauce, open **Segment Alerts**, and click **Enable audio**. Keep the window open while riding. Settings save automatically.

Advance timing estimates distance/current speed. Missing route metadata falls back to the current road, then start/finish only. Live Sauce/Zwift validation is still pending.

## Develop

Plain HTML, CSS, and JavaScript modules. No build step.

```sh
npm ci
npm test
npm run format
```

`pages/adapter.mjs` integrates Sauce; `core.mjs` handles alert state; `audio.mjs` handles sound; `app.mjs` connects the UI.

[Official mod example](https://github.com/SauceLLC/sauce4zwift-mod-example) · [Sauce source](https://github.com/SauceLLC/sauce4zwift)
