# Demo media capture guide

The repository currently has no verified product screenshots or recorded demo. Capture the real app against a disposable kind cluster using the sample fixture; do not use credentials or production cluster data.

## 24-second GIF storyboard

Record a 1280×800 browser viewport at 10–12 fps, then trim to about 24 seconds and optimize for repository display. Keep each transition readable; avoid cursor wandering.

| Time | Screen action |
|---|---|
| 0–5s | Open **Resource graphs** and create a new RGD from the sample manifest. |
| 5–9s | Select **Validate with API**; show the success notice that nothing was saved. |
| 9–13s | Create the definition and wait for KRO to accept it and expose its generated API. |
| 13–18s | Create a `DemoApp` instance with a name, image, and replica count. |
| 18–24s | Open the instance's **Resource graph** tab; select the Deployment and Service nodes. |

Save the optimized animation as `docs/assets/demo.gif`, then add it near the top of the README with concise alt text.

## Four screenshots

Capture separate PNGs at the same viewport and theme:

1. `docs/assets/rgd-catalog.png` — catalog with sample RGD readiness visible.
2. `docs/assets/rgd-validation.png` — manifest editor with successful dry-run message.
3. `docs/assets/instance-form.png` — generated API instance creation form.
4. `docs/assets/resource-graph.png` — instance resource graph with status and inspector visible.

Use realistic sample values and crop out browser profile details. Replace this guide's references in the README only after the images have been checked into the repository.
