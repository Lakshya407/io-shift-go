# ShiftGo Cab Safety — source handover

This ZIP contains the full application source, database migration, build configuration,
dependency lockfile, tests and n8n workflows. Application source revision: **31950dcab5faa3533a4d080032c487811ab60839**.

## Where to start

- **Application setup and local development:** [README.md](README.md).
- **Employee and admin screens:** [app/cab-app.tsx](app/cab-app.tsx), [app/globals.css](app/globals.css).
- **API and persistence:** [lib/](lib/), [app/api/](app/api/), [db/](db/) and [drizzle/](drizzle/).
- **Deployment and first administrator setup:** [docs/OPERATIONS.md](docs/OPERATIONS.md).
- **Settings to supply per environment:** [.env.example](.env.example).

## Which n8n files should I use?

[n8n-cloud-import/](n8n-cloud-import/) contains the three setup files prepared for the company's n8n Cloud workspace:

1. **01-notification-dispatcher.json** — sends queued Teams and email notifications.
2. **02-sos-and-daily-reports.json** — creates due SOS reminders and daily reports.
3. **03-connection-check.json** — a manual, non-sending check of n8n-to-app authentication.

All three exports are inactive. The first two have their schedule triggers disabled for trial
setup. Use these files when recreating the Cloud setup. If the workflows already exist
in your workspace, use those copies; importing these files again would create duplicates.

[automations/](automations/) contains the original workflow templates, generator,
validator, and [credential setup guide](automations/README.md). Those templates
specify more frequent schedules than the Cloud setup exports. Do not activate both sets.

## Before using with employees

Configure the private app connection, webhook, Teams authorization, email sender,
destinations, and operating schedule in your own environment. Verify delivery to the
designated admin with a supervised test. Unzipping the source does not enable alerts.

This source bundle excludes live credentials, employee records, local database state,
installed dependencies, build outputs and Git history. Use the lockfile to install dependencies.
