# Connecting Gmail

cleamail talks to Gmail with your own Google OAuth client. That sounds like extra work, and it is
about three minutes, but it is what keeps the project honest: there is no cleamail server, no shared
quota, and no third party in the middle. The authorization happens between your browser and Google,
and the token lands in your operating system's keychain.

You only do this once.

## 1. Create a Google Cloud project

1. Open [console.cloud.google.com](https://console.cloud.google.com) and create a project. Any name
   works, for example `cleamail`.
2. In **APIs and services > Library**, find **Gmail API** and enable it.

## 2. Configure the consent screen

1. Go to **APIs and services > OAuth consent screen**.
2. Choose **External**, and fill in an app name and your own email address.
3. On the scopes step, add the scope you want cleamail to have. Add one, or both if you plan to try
   read-only first and allow changes later:

   ```
   https://www.googleapis.com/auth/gmail.readonly
   https://www.googleapis.com/auth/gmail.modify
   ```

   `gmail.modify` lets cleamail read messages and change labels, including moving a message to
   Trash. It cannot send mail, and it cannot delete anything permanently.

   `gmail.readonly` lets it read and nothing else. Google refuses any change made with it, so the
   guarantee does not depend on cleamail being correct. Use it with `cleamail init --read-only` to
   try the classifier against your real mail before trusting it with anything.

4. On the test users step, add your own Gmail address. While the app is in testing, only the
   addresses you list here can authorize it, which is exactly what you want.

## 3. Create the client id

1. Go to **APIs and services > Credentials > Create credentials > OAuth client ID**.
2. Choose **Desktop app** as the application type.
3. Copy the **client ID** and the **client secret**.

The "secret" for a desktop client is not really a secret: it ships inside installed applications and
Google knows it. cleamail still sends it because Google expects it, and pairs it with PKCE, which is
what actually protects the exchange.

## 4. Connect

```bash
npx cleamail init
```

To try it read-only first, so nothing can be changed even by a bug:

```bash
npx cleamail init --read-only
```

`cleamail status` prints which of the two you granted, read back from the stored token rather than
from a setting. Re-run `cleamail init` without the flag when you want cleamail to act.

The wizard asks for the client id and secret, opens your browser, and waits on a one-shot listener
at `http://127.0.0.1:<random port>/callback`. After you approve, the tab says you can close it and
the terminal continues.

Nothing is stored in the repository or in the data directory: the token goes to Keychain on macOS,
Credential Manager on Windows, or the Secret Service on Linux.

## What cleamail does with the access

- Reads messages from the last N days (7 by default).
- Adds and removes labels, including `cleamail/Cleaned` and `cleamail/Review`.
- Stars, archives and marks as read, according to the policy and your settings.
- Moves a message to Trash only if you turn the trash rule on, and never for anything important,
  needing a reply, suspicious, starred or allowlisted.

## What it will never do

- Send email, reply or create drafts. The `gmail.send` scope is never requested, and the internal
  Gmail port has no send method to call.
- Delete permanently or empty Trash. That needs the `mail.google.com` scope, which cleamail refuses
  to hold.
- Talk to any host other than `accounts.google.com`, `oauth2.googleapis.com`, `gmail.googleapis.com`
  and your own machine.

## Revoking access

Open [your Google account permissions](https://myaccount.google.com/permissions) and remove the
client. You can also delete the stored credential locally:

```bash
npx cleamail logout
```
