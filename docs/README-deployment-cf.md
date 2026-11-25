# Deploy to BTP Cloud Foundry: push first, connect afterward

Deploy three applications: **CAP**, **Python agent**, and **SAP Approuter**.
All use the same dedicated XSUAA service. Browser login is through Approuter;
CAP/agent communicate through authenticated HTTPS, not CF network policies.

**No domain lookup, hostname selection, or deployment-vars file is needed.** Each
manifest uses `random-route: true`: plain `cf push` selects a route on CF's default
domain. Read the resulting URLs, then configure the connections once.

> PoC limitations: data/conversations are in memory, SAP TP creation is simulated,
> and field/reviewer access share one role. Destination reads and AI Core calls are
> real. Backend HTTPS endpoints validate tokens; only health is public.

## 1. Target CF and provision services

From the repository root, in a terminal or CI job:

```bash
export ROOT="$(pwd)"
cf login
cf target
```

Use the desired org/space. Node >=22.12/npm/CDS CLI are needed for CAP build;
the Python buildpack must support Python 3.12. Services must be entitled.
Create the following only if they do not already exist:

```bash
cf create-service xsuaa application tp-wizard-xsuaa -c xs-security.json
cf create-service destination lite tp-wizard-destination
cf create-service connectivity lite tp-wizard-connectivity
cf services
```

Wait for successful provisioning. Connectivity/Cloud Connector are required for an
OnPremise SAP destination, not an Internet destination. CAP's manifest binds these
instances; all three manifests bind `tp-wizard-xsuaa`. `cds bind` is not needed.

Choose a different `xsappname` in `xs-security.json` if `tp-wizard` conflicts.
The initial redirect URI is a placeholder; it will be replaced with the actual
Approuter callback in Step 4. No user login is attempted before then.
If XSUAA already exists, update it with `cf update-service ... -c xs-security.json`
to apply the descriptor's scopes, then wait for success.

## 2. Push CAP and upload Python/Approuter

```bash
cd "$ROOT/assets/tp-wizard-cap"
npm ci
npm run build
npm test -- --runInBand
cf push

cd "$ROOT/assets/tp-wizard-agent"
cf push --no-start

cd "$ROOT/assets/tp-wizard-router"
npm ci
cf push --no-start
```

`--no-start` allows configuring credentials/connections before Python/Approuter
start. Their routes are assigned during push. No `--vars-file` or explicit route
commands are required. CAP can start before the agent; chat is not ready yet.

Read the assigned routes:

```bash
cf app tp-wizard-cap
cf app tp-wizard-agent
cf app tp-wizard-router
```

Set three shell variables using those actual routes, including `https://`:

```bash
export CAP_URL="https://YOUR_ASSIGNED_CAP_ROUTE"
export AGENT_URL="https://YOUR_ASSIGNED_AGENT_ROUTE"
export ROUTER_URL="https://YOUR_ASSIGNED_ROUTER_ROUTE"
```

Use no trailing slash for these variables. They are deployment outputs, not
hostnames you must know beforehand. Keep the same assigned routes on later pushes;
verify `cf app` output if changing app names/routes.

## 3. Connect the apps and configure the SAP API

```bash
cf set-env tp-wizard-cap AGENT_URL "$AGENT_URL/"
cf set-env tp-wizard-agent CAP_BASE_URL "$CAP_URL"
cf set-env tp-wizard-agent AGENT_PUBLIC_URL "$AGENT_URL/"
cf set-env tp-wizard-router destinations \
  "[{\"name\":\"cap-backend\",\"url\":\"$CAP_URL\",\"forwardAuthToken\":true,\"timeout\":120000}]"

```

### Required customer configuration: SAP destination name

The named SAP destination is **not** the CF service instance
`tp-wizard-destination`, and it is **not** Approuter's `cap-backend` destination.
Find its exact name in the target **BTP subaccount → Connectivity → Destinations**.
Choose the customer destination with the appropriate backend and authentication.

Enter that actual name when prompted (do not copy a placeholder literally):

```bash
printf 'Enter the actual BTP SAP destination name: '
read -r SAP_DESTINATION
test -n "$SAP_DESTINATION" && \
  cf set-env tp-wizard-cap VALUE_HELP_DESTINATION "$SAP_DESTINATION"
cf restart tp-wizard-cap
```

There is **no hardcoded landscape destination or fallback name** in the application.
The customer must set `VALUE_HELP_DESTINATION` once per deployment; missing names
and obvious placeholders are rejected. Environment changes require a restart,
not a rebuild. Local `.env` does not configure the deployed CF application.

All backend API mapping values are configurable on **CAP**, not Python/Approuter:

| CF environment variable | Purpose |
|---|---|
| `VALUE_HELP_DESTINATION` | Exact customer BTP destination name (required) |
| `VALUE_HELP_SERVICE_PATH` | Relative backend service path |
| `VALUE_HELP_ENTITY_SET` | Entity set to read |
| `VALUE_HELP_KEY_FIELD` | Selected code property |
| `VALUE_HELP_TEXT_FIELD` | Display description property |
| `VALUE_HELP_ODATA_VERSION` | `2` or `4` |

The standard Business Partner API below is only a configurable technical example.
If overriding its mapping with `cf set-env`, update matching manifest values too
so future pushes do not reset those API defaults. Destination credentials remain
in BTP; never copy them into these environment settings or the frontend.

The address settings mean:

| Variable | Purpose |
|---|---|
| CAP `AGENT_URL` | Send chat to Python |
| Python `CAP_BASE_URL` | Send authenticated tool requests to CAP |
| Python `AGENT_PUBLIC_URL` | Advertised A2A agent address |
| Approuter `destinations` | Browser requests forwarded to CAP with user token |

The supplied CAP manifest defaults to:

```text
Service: /sap/opu/odata/sap/API_BUSINESS_PARTNER
EntitySet: A_BusinessPartner
Code: BusinessPartner
Description: BusinessPartnerFullName
OData version: 2
```

Override `VALUE_HELP_SERVICE_PATH`, `VALUE_HELP_ENTITY_SET`, `VALUE_HELP_KEY_FIELD`,
`VALUE_HELP_TEXT_FIELD`, or `VALUE_HELP_ODATA_VERSION` through `cf set-env` when
needed. Keep SAP host/Basic Auth credentials/Location ID in BTP Destination, not
app manifests. Avoid duplicating the service path in the destination URL.
Business Partners are an example data source, not actual DS100 locations.

No extra agent-to-CAP destination or network policies are needed: these connections
use direct HTTPS with XSUAA bearer tokens. Python acquires a client-credentials
token from its binding. CAP forwards authenticated browser tokens to the agent,
or acquires a technical token for invocation when needed.

## 4. Register the actual login callback and user access

Edit the root `xs-security.json` and replace the placeholder redirect URI with:

```text
<actual ROUTER_URL>/login/callback
```

For example, paste the route assigned to Approuter followed by `/login/callback`.
Use an exact HTTPS callback, not a broad wildcard. Update XSUAA:

```bash
cd "$ROOT"
cf update-service tp-wizard-xsuaa -c xs-security.json
cf service tp-wizard-xsuaa
```

Wait for update success. All components must use the same dedicated XSUAA instance
for this PoC.

### Required: assign browser users the application role

Successful XSUAA login does **not** automatically grant application access. Before
opening the UI, assign the **TP Wizard Users** role collection to each authorized
user, including the deployer if they will test the application:

1. Open the target **subaccount** in BTP Cockpit (not the CF application page).
2. Navigate to **Security → Role Collections**.
3. Select **TP Wizard Users**, then choose **Edit**.
4. Under **Users**, add the user's login identifier and select the identity
   provider used for their browser login.
5. Save the assignment.

If the collection is missing, an authorized administrator can create it and add
the **WizardUser** role from this deployment's TP Wizard application identifier.
Ensure it references the correct XSUAA application, not another deployment with
a similar name. If WizardUser is not available, check that the XSUAA descriptor
update completed successfully. CF space/deployer permissions alone do not grant
this application role.

After assignment, obtain a **new login session**: close existing application tabs
and open the Approuter URL in a fresh Incognito/private browser session, then log
in again. An existing access token does not gain scopes when a role is assigned.
No application rebuild/redeployment is needed for role assignment alone.

WizardUser enables UI/manual approval; technical CAPTools and AgentInvoke
authorities allow trusted app-to-app calls, not approval.

## 5. Transfer AI Core configuration (not the .env file)

Local `.env` files/virtual environments are excluded by `.cfignore` and are not
automatically copied into BTP. Service credentials come through `VCAP_SERVICES`.
The current agent's AI Core direct-mode loader needs these app variables:

```text
AICORE_CLIENT_ID
AICORE_CLIENT_SECRET
AICORE_AUTH_URL
AICORE_BASE_URL
AICORE_RESOURCE_GROUP
```

Supply them from an approved CI secret store, or reuse a trusted `.env` in a private
deployment terminal. Only the listed variables are transferred:

```bash
cd "$ROOT/assets/tp-wizard-agent"
(
  set -a
  source .env  # omit if CI already supplies the variables
  set +a
  : "${AICORE_CLIENT_ID:?Missing client ID}"
  : "${AICORE_CLIENT_SECRET:?Missing client secret}"
  : "${AICORE_AUTH_URL:?Missing auth URL}"
  : "${AICORE_BASE_URL:?Missing base URL}"
  cf set-env tp-wizard-agent AICORE_CLIENT_ID "$AICORE_CLIENT_ID" &&
  cf set-env tp-wizard-agent AICORE_CLIENT_SECRET "$AICORE_CLIENT_SECRET" &&
  cf set-env tp-wizard-agent AICORE_AUTH_URL "$AICORE_AUTH_URL" &&
  cf set-env tp-wizard-agent AICORE_BASE_URL "$AICORE_BASE_URL" &&
  cf set-env tp-wizard-agent AICORE_RESOURCE_GROUP "${AICORE_RESOURCE_GROUP:-default}"
)
```

Check all commands succeeded. Do not use shell tracing, record the terminal, commit
secrets, or share `cf env`: sufficiently privileged users can inspect app variables.
This is not a secrets vault. Binding AI Core alone does not establish that this
SDK direct-mode loader consumes its credentials from `VCAP_SERVICES`.

## 6. Start and open the solution

```bash
cf restart tp-wizard-cap
cf start tp-wizard-agent
cf start tp-wizard-router
```

If already running, restart the affected app after environment changes. First
start stages uploaded apps. Dependency/buildpack changes require re-push/restage.

Open **your assigned Approuter URL + `/field/`**. XSUAA performs browser login;
direct CAP URLs do not provide interactive login. Approval UI is at the same
Approuter URL + `/approve/webapp/index.html`.

Check:

```bash
curl -i "$CAP_URL/health"
curl -i "$CAP_URL/wizard/listPendingSessions()"
curl -i "$AGENT_URL/.well-known/agent-card.json"
cf logs tp-wizard-cap --recent
cf logs tp-wizard-agent --recent
cf logs tp-wizard-router --recent
```

Health should be 200; unauthenticated CAP data/agent card should be 401. Valid
tokens missing scopes yield 403. Login requires the role collection and registered
callback. Test SAP value help, EWR chat, submission, review and mocked approval.
Model/destination access still needs verification after deployment.

## Updates and troubleshooting

### Destination lookup returns 502 / Bad Gateway

First inspect CAP logs, not just the browser response:

```bash
cf logs tp-wizard-cap --recent
```

If the log names a placeholder such as `YOUR_BASIC_AUTH_DESTINATION`, the guide's
example was copied without substitution: set the real name using Step 3's prompt
and restart CAP. A 502 by itself does not identify Basic Auth, Cloud Connector,
or SAP authorization as the cause. Other checks: correct subaccount/service
bindings, exact destination name, Cloud Connector host/Location ID/path mappings,
Basic Auth credentials/API permissions and service URL. Never share credentials
or tokens from diagnostic logs.

- Rebuild/re-push CAP with plain `cf push` from its folder; re-push Python/Approuter
  from their folders. Address settings are not overwritten by manifest env entries.
- If assigned URLs change, repeat Step 3 and update the callback in Step 4.
- No `deployment-vars.yml`, `cf domains`, internal routes, SSH or network-policy
  commands are part of this workflow.
- Remove obsolete internal mappings if migrating from the old private setup.
- Never switch cloud auth back to mocked; XSUAA binding is required at startup.
- Browser login 403: assign role collection, sign out/in. Callback error: register
  exact Approuter URI and update XSUAA. Tool 403: verify shared binding/authorities.
- Value help 502: destination name, bindings, Basic Auth rights, Cloud Connector
  mappings. AI Core errors: credentials, resource group and model availability.
- In-memory sessions are lost on restart. Field/reviewer roles and client separation
  remain PoC limitations. Existing agent instruction/document-tool issues are not
  automatically resolved by deployment. SAP TP writes remain mocked.

### Browser immediately displays “Forbidden”

Check Approuter logs:

```bash
cf logs tp-wizard-router --recent
```

If the logs report `required scopes: <xsappname>.WizardUser` but
`user scopes: openid`, authentication succeeded and **application authorization
is missing**. Follow Step 4's role-collection assignment and log in with a fresh
session. Do not remove the route scope check or change cloud authentication to
mocked. A correct backend destination URL does not resolve missing user scopes.