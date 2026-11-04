# ShiftGo operations

## Deployment boundary

This repository contains the employee and administrator webapp, its server API and D1 schema, and the n8n workflow exports in `automations/`.

The hosted review deployment starts **owner-private**. Its outer access gate is managed by Sites. An employee account in the app does not itself grant permission through that outer gate. Before an employee rollout, configure the Site audience for the intended employees or deploy the application to an environment with an appropriate company access policy. Review the effect of the audience change before making it.

The app also uses company-issued employee credentials. Creating an app account and granting hosting access are separate steps. Preserve the Sites authentication integration; do not treat a browser-supplied owner identity header as trustworthy on another hosting platform.

## First administrator

The configured owner email for this deployment is `io.codex@infoorigin.com`. First-time setup is restricted to the corresponding authenticated owner through the hosting platform. There is no published default administrator password.

Open the app through the owner's signed-in session, complete setup, and choose a unique administrator password. Then configure company details, office details, notification recipients, emergency contact, and reporting settings. Create employee accounts and communicate temporary passwords through the company's normal secure channel. Do not put credentials in a shared report or source repository.

A demo workspace is separate from production records. Demo interactions do not establish that a production notification was delivered.

## Connect n8n

The files in `automations/` are importable workflow definitions. They are **not proof of an active n8n deployment**. A running n8n instance and company-approved Microsoft Teams and email credentials are required.

Use `automations/README.md` for the exact import and credential steps. At a high level:

1. Import both workflow JSON files.
2. Set the app's HTTPS origin and sender address in each applicable Configuration node.
3. Create an app automation token in the admin integration screen and store it in an n8n Custom Auth credential as `X-Automation-Key`.
4. For an owner-private hosted Site, also configure the supported hosting service-access credential as `OAI-Sites-Authorization: Bearer …`. An app API token does not bypass the hosting access gate. Obtain service access through supported Site settings; do not disable access controls as a workaround.
5. Configure Microsoft Teams OAuth2 and SMTP credentials in n8n. Select the intended team and channel IDs and recipients in the app.
6. Configure the authenticated wake-up webhook using the environment names documented in `.env.example`. Scheduled polling provides recovery if a wake-up is missed.
7. Run supervised tests with designated company recipients. Publish/activate both workflows only after confirming the intended destination and delivery behavior.

Keep secrets in the host's secret manager and n8n credential store. Do not paste secrets into workflow Code nodes, UI code, source files, deployment archives, or reports.

## What delivery status means

The app records the trip or SOS before attempting notification work. The durable job queue is separate from the event record.

- **Pending/queued:** saved for a future delivery attempt.
- **Leased:** a worker has temporarily claimed the job.
- **Sent/provider accepted:** the receiving provider accepted a message. It does not prove that an administrator read it.
- **Failed/blocked:** delivery needs attention or configuration.
- **Acknowledged SOS:** an authenticated administrator explicitly acknowledged the incident in the app.
- **Resolved SOS:** an administrator recorded resolution. Keep the incident history available for review.

Teams and email have independent outcomes. A successful email does not imply that Teams succeeded. A provider can accept a message just before a network failure prevents its receipt from being stored; recovery may send a duplicate. The design is intended to preserve work and make uncertainty visible, not guarantee exactly-once external delivery.

## Nightly operation

Keep n8n running and both workflows active. The dispatcher polls for notification work and can also wake immediately through a configured webhook. The maintenance workflow asks the app to generate due SOS reminders and daily report records.

The initial reporting defaults use `Asia/Kolkata`, an 08:00 shift cutoff and 09:00 report time. Review these against the actual shift schedule. Reports should be interpreted using their explicit period boundaries, including journeys that cross midnight. An unclosed journey requires investigation; it is not evidence that an employee reached their destination. The main Export action downloads a rolling 24-hour log; an archived report’s CSV uses that report’s fixed period. Once a report exists, maintenance can catch up up to seven subsequent due periods per tick after an outage. The first maintenance report covers the most recent closed period. The daily report stores period boundaries and summary counts. Its CSV is generated from the current database records when downloaded, rather than stored as an immutable file snapshot. Preserve downloaded files separately if a fixed historical export is required.

At the start of a shift, confirm the admin console can reach the server, the automation heartbeat is current, and alert recipients are on duty. Monitor failed or blocked notifications and open incidents. Test operational changes with known test accounts and recipients.

## Emergency operation and browser limits

The SOS flow is an additional company communication channel. It cannot guarantee a human response. An offline browser cannot send an SOS to the server. The UI must show an unsent/offline state and a call option rather than displaying a successful alert.

Location is captured for trip events, not continuous background tracking. It requires HTTPS and browser permission. Location can be missing or inaccurate. A record with no location must remain usable and clearly marked; do not interpret a map pin as proof of presence.

Do not rely on background synchronization after a browser or phone is closed. Employees should keep the app open until the event's recorded status is confirmed. Use the configured company emergency phone when data service or notification delivery is uncertain.

## Data and access

The hosted app uses Cloudflare D1 for persistent records. Browser state is used for interface behavior and temporary pending work, not as the authoritative multi-user database. n8n execution history is not the authoritative cab log.

Restrict admin access and periodically review active employee accounts, roles, delivery recipients, and company contact details. Deactivate former employees promptly. Treat locations, contact information, travel times, and incident records as company-sensitive data. The app’s `retentionDays` value records a policy preference; automatic deletion of trip, location, incident, or audit records is not implemented in this version. Arrange an approved cleanup process and backup policy before relying on that preference. n8n execution pruning is configured separately in n8n. Expired app sessions and old rate-limit counters are cleaned during maintenance.

For another hosting provider, review trusted identity headers, secure cookies, HTTPS, environment secrets, database backup/restore, and network access. The application expects D1 bindings; replacing it with MySQL requires a database adapter and migration work. Simply supplying a MySQL URL will not change the storage engine.

Password hashes use salted PBKDF2-SHA-256 with 100,000 iterations in the Workers runtime. Sessions use randomly generated opaque tokens whose hashes are stored server-side, with a 12-hour cookie lifetime. Custom employee password authentication has no separate app-level MFA; the outer host access policy is an additional boundary. Review authentication requirements before moving the app to a different access environment.

## Recovery

A notification worker outage should leave recorded trip/SOS events and pending jobs intact. Restore n8n access and inspect the queue before retrying jobs manually. Avoid replaying historical SOS alerts to a live on-duty channel without checking their incident state.

Use a known database backup before substantial migrations. Treat applied migration files as immutable. Preserve the source version and workflow revision deployed together so API-contract mismatches can be diagnosed.

Live Microsoft Teams delivery, live SMTP delivery, and company-device location permission flows require a supervised end-to-end test in the actual company environment. Automated or demo checks cannot substitute for those operational tests.
