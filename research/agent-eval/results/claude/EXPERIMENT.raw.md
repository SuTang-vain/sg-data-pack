# Agent success-rate experiment

- Experiment: `experiment:20c81f58da37a1b7f17b7239e57dd9d7036ebce72529827e387f7ba48d536de3`
- Agent: claude-code-2.1.185 / sonnet alias (provider metadata recorded) (ai)
- Trials: 15; valid 14; infra 1
- Pass rate: **50.0%** (Wilson 95% 26.8%–73.2%)
- Claim level: **ai-static-contract-only**
- Actual model(s): MiniMax-M3[1M]
- Tokens: input 22223; output 94361; cache read 1792
- Recorded provider cost: $2.471036

## Failure taxonomy

- infra-error: 1
- passed: 7
- patch-invalid: 7

## Trials

- field-update-r01: patch-invalid; patch=rejected; grades=none
- field-update-r02: patch-invalid; patch=rejected; grades=none
- field-update-r03: passed; patch=applied; grades=passed
- field-update-r04: passed; patch=applied; grades=passed
- field-update-r05: passed; patch=applied; grades=passed
- alias-relation-r01: passed; patch=applied; grades=passed
- alias-relation-r02: passed; patch=applied; grades=passed
- alias-relation-r03: patch-invalid; patch=rejected; grades=none
- alias-relation-r04: patch-invalid; patch=rejected; grades=none
- alias-relation-r05: passed; patch=applied; grades=passed
- pattern-c-runtime-r01: patch-invalid; patch=rejected; grades=none
- pattern-c-runtime-r02: infra-error; patch=none; grades=none
- pattern-c-runtime-r03: patch-invalid; patch=rejected; grades=none
- pattern-c-runtime-r04: passed; patch=applied; grades=passed
- pattern-c-runtime-r05: patch-invalid; patch=rejected; grades=none
