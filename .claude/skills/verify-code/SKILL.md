---
name: verify-code
description: Use to fully verify changes made to code.
---

Verify the current changes pass all quality checks. Run these steps in order, attempting to fix any failures or stop if
you are unable to fix the failures:

1. **Syntax check** all JS files: `node --check main.js src/**/*.js`
2. **Test** the code: `npm test`

Report a summary of results for each step. If any step fails, diagnose the issue and suggest a fix.
