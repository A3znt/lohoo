# Resala client

Small server-side TypeScript client for the three calls in the [Resala plain-text reference](https://dev.resala.ly/resala-api.txt). It uses the production base URL supplied for this integration. The public reference shows `dev.resala.ly`; pass `baseUrl` to `createResalaClient` only if you intentionally need another environment.

Set `RESALA_API_KEY` in the server process environment. Do not expose it to browser code.

```ts
import { createResalaClient, ResalaApiError, ResalaTransportError } from "./src/resala.ts";

const resala = createResalaClient();

try {
  const pin = await resala.createPin("0940055051");
  // The supplied production response has id, phone, status, sender_name.
  // The public reference also documents a response with pin; if present,
  // store and verify it on your server. There is no verify-PIN endpoint here.
  console.log(pin.id, pin.status, pin.sender_name);
} catch (error) {
  if (error instanceof ResalaApiError) {
    switch (error.type) {
      case "InputValidation":
        console.error(error.errors); // field -> messages
        break;
      case "InsufficientCredit":
      case "AccountExpired":
      case "Unauthorized":
      case "TokenExpired":
      case "Forbidden":
      case "NotFound":
      case "BadRequest":
      case "UnknownResponse":
        console.error(error.type, error.requestId);
        break;
    }
  } else if (error instanceof ResalaTransportError) {
    // The send may have succeeded. Check getSentView before deciding what to do.
    console.error(error.message);
  } else {
    throw error;
  }
}
```

`sendMessage(phone, content, options)` sends one free-text SMS, if the account has that permission. `sendTemplate(templateId, records, options)` sends approved templates. Check `invalid_numbers`, `failed_numbers`, and `sender_names` in its response; invalid or international recipients are skipped by that endpoint. `getSentView(options)` reads the message log, where delivery state can update after a send. The client makes one HTTP attempt per call and never retries a send.

Run `npm install`, `npm run typecheck`, and `npm test` to verify locally. Tests mock HTTP and never send an SMS.
