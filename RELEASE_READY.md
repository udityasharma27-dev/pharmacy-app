# Release Readiness

This project is much closer to production than before, but these items still need to be completed by the business owner before selling to customers.

## 1. Production Secrets

Set these in Render:

- `MONGO_URI`
- `OWNER_PASSWORD`
- `STAFF_PASSWORD`
- `TOKEN_SECRET`
- `TOKEN_TTL_HOURS`
- `ALLOW_MANUAL_UPI_CONFIRM`

Recommended:

- use strong random passwords for owner and staff
- use a long random `TOKEN_SECRET`
- keep `ALLOW_MANUAL_UPI_CONFIRM=true` only if the pharmacy workflow requires manual UPI confirmation

## 2. Real Payment Gateway

The app currently supports manual confirmation flows for:

- UPI / QR
- cash
- cash on delivery

To move to a real payment provider, choose one gateway and provide its credentials:

- Razorpay
- PhonePe Business
- Cashfree
- Stripe

What is still needed from the business:

- merchant account credentials
- webhook secret
- preferred payment provider
- business settlement flow

## 3. Signed Release APK

The current output is a debug APK. Before selling widely, create a signed release build.

You need:

- Android keystore file
- keystore password
- key alias
- key password

Then configure Android Studio for a release build and generate a signed APK or AAB.

## 4. QA Checklist

Test on at least:

- 2 Android phones
- 1 owner account
- 1 staff account
- 1 weak network condition

Pass these flows before selling:

- owner login
- staff login
- create store
- switch stores
- add medicine
- edit medicine
- delete brand
- create bill
- reopen app and continue working
- logout and login again
- backup export
- backup import on a test database

## 5. Backup and Audit

Owner-only backend endpoints are available for:

- backup export
- backup import
- audit log listing

Use them carefully and test restore on a non-production database first.

## 6. Go-Live Advice

Before customer rollout:

- deploy latest code from `main`
- set final secrets in Render
- test production website
- install latest APK on a second phone
- create one real store and 5-10 real medicines
- complete one end-to-end bill
