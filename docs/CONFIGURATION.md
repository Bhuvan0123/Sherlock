# Configuration

Create `.env` from `.env.example` and set:

```env
ADO_ORGANIZATION=your_organization
ADO_PROJECT=your_project
ADO_TEAM=your_team
ADO_PAT=your_personal_access_token
SHERLOCK_ENV=development
LOG_LEVEL=info
TOKEN_DEBUG=false
```

Runtime code reads configuration through `src/config/env.ts`. Required values are validated at startup and the PAT is never printed.

Azure DevOps saved queries created by S.H.E.R.L.O.C.K. are automatically organized by the configured team under `My Queries/{Team Name}`. This keeps queries isolated and manageable when the same project contains multiple teams.
