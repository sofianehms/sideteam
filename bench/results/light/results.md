# Benchmark results

Date: 2026-11-23T08:49:33.547Z
Coverage: 12/18 trials (partial)

- Claude versions: 2.1.330 (Claude Code). Models: claude-sonnet-5-5.
- codex versions: 0.169.0. Models: n/a.

| Level | Arm | Engine | Success rate | Median Claude tokens | Median cache read | Savings (1 − B/A) | Median engine tokens | Median duration (s) | Cost per successful task (USD) |
| --- | --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| easy | A | — | 50.0% | 14289 | 65914.5 | n/a | n/a | 6.644 | $0.134427 |
| easy | B | codex | 50.0% | 14320 | 54962.5 | -0.2% | 0 | 7.080 | engine cost n/a |
| medium | A | — | 100.0% | 15083.5 | 66153.5 | n/a | n/a | 10.252 | $0.073166 |
| medium | B | codex | 100.0% | 15416 | 66677.5 | -2.2% | 0 | 10.791 | engine cost n/a |
| hard | A | — | 100.0% | 17140 | 66196.5 | n/a | n/a | 13.873 | $0.086059 |
| hard | B | codex | 100.0% | 18307.5 | 90590.5 | -6.8% | 0 | 17.021 | engine cost n/a |
