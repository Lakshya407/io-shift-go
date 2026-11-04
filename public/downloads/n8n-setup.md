# ShiftGo Cab — n8n automation

These are ready-to-import workflow definitions. They are **inactive and contain no credentials**. Importing a JSON file does not start notifications. The company must connect its n8n instance, Microsoft 365 account and email sender, test the complete path, then publish the workflows.

## Included workflows

| File | Behaviour |
| --- | --- |
| `01-notification-dispatcher.json` | An authenticated wake-up webhook starts delivery promptly. A 30-second schedule also claims pending jobs for recovery. Each job sends either a Teams message or one email, then records that provider's result in the app. |
| `02-sos-and-daily-reports.json` | Every minute, asks the app to queue due SOS reminders and daily reports. The app owns the reporting period, time zone, repeat limits and acknowledgment checks. |

All message content and destinations come from authenticated app records. The wake-up body is ignored; a caller cannot inject arbitrary email destinations through that webhook. App settings determine future messages. Failed jobs and earlier recipient snapshots remain auditable.

The dispatcher processes at most **five jobs per execution**, one at a time, and records each result before moving to the next. The app leases jobs for five minutes; the workflow has a four-minute execution timeout. Distinct executions may run concurrently, but a job has one valid lease. Increase throughput only after checking provider limits and lease timing.

## 1. Import and configure

1. Import both JSON files into your n8n instance.
2. Open **Configuration** in each workflow and set `baseUrl` to the actual HTTPS app origin, without a path or trailing slash.
3. In the dispatcher configuration, set `fromEmail` to a sender your SMTP account is permitted to use. The maintenance workflow does not send mail itself.
4. Replace the clearly named placeholder credentials on the relevant nodes, as described below.
5. Keep the workflows unpublished until the supervised tests below pass.

Use the app's production URL, not a temporary browser-preview address. Leave TLS certificate verification enabled. HTTP app calls do not follow redirects, so an accidental sign-in redirect fails visibly instead of appearing successful.

### App API credential

Create an n8n **Custom Auth** credential named **Cab app automation API**. Its JSON is:

```json
{
  "headers": {
    "X-Automation-Key": "YOUR_APP_AUTOMATION_KEY"
  }
}
```

Generate the automation token in the app's admin integrations screen; the app stores its hash. Alternatively, an operator may configure the server-side `AUTOMATION_API_KEY` runtime secret. Use the selected token in this credential. Save it in n8n's credential store, never in the Configuration node, workflow JSON, employee browser or chat message. Rotating the app token also requires updating this credential. Select this credential on **Lease pending jobs**, **Record delivery result**, and **Generate due reminders and reports**.

For a Site protected by a separate platform sign-in gate, the app key alone cannot pass that outer gate. When a supported Site service-access token is available, add the second header **inside the same credential**:

```json
{
  "headers": {
    "X-Automation-Key": "YOUR_APP_AUTOMATION_KEY",
    "OAI-Sites-Authorization": "Bearer YOUR_SITE_SERVICE_ACCESS_TOKEN"
  }
}
```

The platform service token is separate from the app key and supplies no employee identity. Do not use an employee cookie as unattended service authentication. A deployment on company infrastructure without this outer gate needs only the app key. Obtain supported service access before activating a privately hosted deployment's scheduled workflows.

### Microsoft Teams credential

Create/select **Microsoft Teams OAuth2 API** and bind it to **Send Teams alert**. The node uses that credential with Microsoft Graph's channel-message endpoint. The signed-in work/school account needs access to the selected team/channel, and its delegated permissions must permit `ChannelMessage.Send`. Tenant consent requirements may require your Microsoft 365 administrator.

Use delegated OAuth for ordinary channel messages. An app-only credential with `Teamwork.Migrate.All` is a migration permission and is not the normal sending route. Enter the real Team ID and Channel ID in the webapp's admin settings. The default Graph origin is the global Microsoft cloud; use the appropriate endpoint and matching credential configuration if your tenant uses another Microsoft cloud.

SOS messages use `importance: high` and the app's SOS heading. Teams channel messages do not guarantee an audible notification or that somebody has read the alert. Admin acknowledgment remains an authenticated action in the webapp.

### Email credential

Create an **SMTP** credential named **Cab alerts SMTP** and bind it to **Send email alert**. Configure your approved SMTP host, port and authentication in n8n. Keep TLS validation on. The configured sender must be permitted by the SMTP service.

The app produces one email job per recipient, avoiding partial-recipient retries that resend to already accepted addresses. The workflow confirms the SMTP response contains the recipient in `accepted`, no rejected recipient, and a message ID. SMTP acceptance does not prove inbox delivery or reading. If your organization prohibits SMTP authentication, replace this branch with its supported Microsoft Outlook/Graph mail node and preserve the same result contract after testing.

### Immediate wake-up credential

Create **Header Auth** named **Cab wake-up webhook**:

- Header name: `X-Cab-Webhook-Key`
- Header value: a dedicated random secret, different from the app API key.

Bind it to **Immediate wake-up**. Set the app's server-side `N8N_WEBHOOK_URL` to that node's **production** URL, normally ending in `/webhook/cab-notification-wakeup`, and set `N8N_WEBHOOK_SECRET` to the matching value. The app records an event durably before attempting the wake-up. A successful `202` response means the wake-up was accepted, not that a Teams/email message was delivered.

The 30-second poll recovers a missed wake-up. While n8n is down, records remain in the app and new messages cannot be delivered by these workflows. Keep a staffed emergency telephone option available.

## 2. App API contract

All endpoints are server-to-server, use the Custom Auth credential, and return JSON. They must reject missing/incorrect keys. An authenticated employee is not entitled to these service endpoints merely by being signed in.

### Claim jobs

`POST /api/automation/jobs/claim`

```json
{"limit":5,"workerId":"n8n-execution-id"}
```

Response:

```json
{
  "jobs": [
    {
      "id": "job-id",
      "leaseToken": "opaque-lease-token",
      "channel": "email",
      "payload": {
        "subject": "SOS — employee needs assistance",
        "text": "Employee details, recorded time, location status and admin link",
        "html": "<p>Escaped content prepared by the app</p>",
        "to": ["admin@your-company.example"],
        "priority": "high"
      }
    }
  ]
}
```

Teams jobs have `channel: "teams"` and require `payload.teamId` and `payload.channelId`. `html` is optional; `text` is required. Use `priority: "high"` for SOS and `"normal"` for routine messages. An empty queue returns `{"jobs":[]}`.

### Record a result

`POST /api/automation/jobs/{id}/receipt`

```json
{
  "leaseToken": "opaque-lease-token",
  "status": "sent",
  "providerId": "provider-message-id",
  "error": null
}
```

On failure, use `status: "failed"`, `providerId: null`, and a bounded error string. The backend owns bounded retries, delay/backoff, expired-lease recovery and terminal failure visibility. Receipt requests retry safely because the backend makes them idempotent for the same lease. Provider send nodes themselves do not automatically retry.

`sent` means **the provider accepted the message**, not “employee is safe,” “admin read it,” or “SOS acknowledged.” If a provider accepts a message but its response or subsequent receipt is lost, a later retry may duplicate the message. This implementation does not claim exactly-once notification delivery.

### Generate due work

`POST /api/automation/tick`

```json
{"workerId":"n8n-maintenance-execution-id"}
```

The backend idempotently creates due daily report and SOS reminder jobs, using its current admin settings. It rechecks SOS acknowledgment/resolution and cancels pending reminder jobs accordingly. An already submitted provider message cannot be recalled by acknowledging the SOS. Reports preserve overnight trips and use the configured shift cutoff; the default time zone is `Asia/Kolkata`.

## 3. Test, then publish

Use a designated test employee and administrators who expect the test. These workflows have no fabricated sample events and do not send a message merely because a workflow is imported.

1. Configure the app recipients, Microsoft Teams destination and emergency telephone number.
2. Create a boarding event. Manually run the dispatcher. Confirm the Teams message and email, and their separate app job results.
3. Record arrival and confirm the correct destination label, timestamp and location status.
4. Trigger a supervised SOS, including a location-permission-denied case. Confirm an SOS record is saved promptly and an alert is queued without waiting for GPS.
5. Make one provider unavailable; verify the other channel still sends and the failed channel is visible for recovery.
6. Repeat a claim concurrently; verify a leased job is not given to both workers. Retry the same receipt; verify it is harmless.
7. Let an SOS reminder become due, then acknowledge in the app. Verify later reminder jobs are no longer sent.
8. Run maintenance against a due reporting period and inspect report counts, time zone, midnight handling and the access-controlled report link.
9. Disconnect the employee phone from the network. Confirm the UI says an SOS was **not transmitted**, rather than claiming it was sent. Test the displayed call option separately.
10. Publish both workflows. Verify a real scheduled execution and a production webhook execution. n8n needs to remain available throughout the night shift.

Choose n8n execution retention appropriate to employee location/contact data. These exports keep successful execution payloads off and failed executions on for troubleshooting; apply pruning and restrict administrator access. The app database remains the operational record. Enable n8n instance health/uptime monitoring and an operational failure route appropriate to your company's monitoring tools.

## Local validation

```sh
node automations/verify-workflows.mjs
```

This checks export structure, node connections, JavaScript syntax, and representative success/failure result transformations. It does **not** test an n8n import, a live n8n execution, Microsoft tenant permissions, SMTP delivery or platform service access. Those need the configured services and supervised checks above.

## Primary documentation

- [n8n Schedule Trigger](https://docs.n8n.io/integrations/builtin/core-nodes/n8n-nodes-base.scheduletrigger/)
- [n8n HTTP Request](https://docs.n8n.io/integrations/builtin/core-nodes/n8n-nodes-base.httprequest/)
- [n8n Custom Auth credentials](https://docs.n8n.io/integrations/builtin/credentials/httprequest/#using-custom-auth)
- [n8n Microsoft Teams credentials and operations](https://docs.n8n.io/integrations/builtin/app-nodes/n8n-nodes-base.microsoftteams/)
- [Microsoft Graph: send a channel message](https://learn.microsoft.com/en-us/graph/api/channel-post-messages?view=graph-rest-1.0)
- [n8n Send Email](https://docs.n8n.io/integrations/builtin/core-nodes/n8n-nodes-base.sendemail/)

Workflow templates prepared 29 October 2026. Node versions are explicit in the exports. Review any migration warnings shown by your installed n8n version before publication.
