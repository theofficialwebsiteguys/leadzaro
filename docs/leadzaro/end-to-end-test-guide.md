# Leadzaro end-to-end test run

This takes about 60–90 minutes and covers the whole path: set up, find a lead, work it, get paid through Stripe in test mode, hand it off, then check the results. **Expect:** lines tell you what should happen.

**Rule for the whole run:** Find Leads returns real businesses, so don't call, text or email them. Do all outreach to one test lead you create with your own contact details.

---

## 0. Before you start (10 min)

1. Have these running:
   - the database (`leadzaro_db` in Docker)
   - the API on port 3000, restarted after your `.env` changes
   - the Angular app on port 4200
   - `stripe listen …` in its own window:
     ```
     stripe listen --forward-to localhost:3000/api/v1/billing/webhooks/stripe --events checkout.session.completed,checkout.session.async_payment_succeeded,checkout.session.async_payment_failed,checkout.session.expired,invoice.paid,invoice.payment_failed,customer.subscription.created,customer.subscription.updated,customer.subscription.deleted,charge.refunded
     ```
2. In the Stripe Dashboard (**Test mode**), create two products:
   - "Website Build" — **one-time**, $1,500
   - "Website Care" — **recurring monthly**, $99
3. In Leadzaro, go to **Settings → Integrations**.
   - **Expect:** Stripe shows *Test mode*, Outreach email shows *Connected*, Namecheap shows *Connected*.
4. **Settings → Workspace:**
   - add the company phone and email
   - set the timezone
   - save
5. **Settings → My account:** add your mobile number and save.
6. **Settings → Sales preferences:**
   - set search keywords and location (for example "plumbers" and your city)
   - add a signature
   - set a weekly goal, for example 5 attempts
   - save
7. Open **Dashboard**.
   - **Expect:** the "Finish setting up" checklist lists only what's still missing.

## 1. Find and add leads (10 min)
 -Whole section needs toi be more advanced with location mapping with google. And lead info expansion within the row before adding to gather more details
1. Open **Find Leads**.
   - **Expect:** keywords and location are already filled in from your preferences.
2. Search, then click **Add to leads** on one result.
   - **Expect:** the button changes to **Open**, and the result shows its stage and owner.
3. Search again.
   - **Expect:** that business is shown as already in Leads.
4. Go to **Leads → Add lead** and create your **test lead**:
   - business name: `TEST – Your Name Bakery`
   - business phone: your mobile
   - business email: a second address you own, such as `theofficialwebsiteguys+lead@gmail.com` (Gmail delivers `+anything` to your inbox)
   - contact name: yourself
5. Try adding another lead with the **same phone number**.
   - **Expect:** a "possible duplicate" review with three choices: Open, New deal for this business, or add anyway.
   - Cancel it.

## 2. Work the test lead (15 min)

1. Open the test lead.
   - **Expect:** at the top, the business, contact, owner, stage (**New**), last contact, next step and payment status.
   Needs to be more readable for easily view and understable
   - **Expect:** the recommended next step is **"Make first contact"**.
   Love the recomended step, needs to be more intentional though
2. Click **Call**. Your phone app opens; cancel the call and come back.
   - **Expect:** the **Log what happened** form pops up.
   - Choose **Left voicemail**, pick **In 2 days**, and click **Save**.
   - **Expect:** stage **Contacting**, and the call appears in the conversations list marked "Logged".
3. Click **Email** and pick the **First email** template.
   - **Expect:** the business name and your signature are filled in.
   - Type `{{meeting_time}}` into the body. **Expect:** sending is blocked until you replace it.
   - Remove it and click **Send**.
   - **Expect:** the message arrives in your `+lead` inbox, and the conversation shows **"Sent from Leadzaro"**.
4. Reply to that email from the `+lead` inbox. It lands in your own inbox, because replies go to your login address.
   - Back in Leadzaro, open the **⋯** menu → **Log a reply they sent**.
   - **Expect:** a red **"Reply to their message"** banner.
5. Open **Today**.
   - **Expect:** the lead appears under **Replies waiting on you**, and the weekly goal bar has moved.
6. Click **Work next lead** → **Start**.
   - **Expect:** a dark queue bar showing "lead 1 of N".
   - Click **Log outcome** → **Interested** → pick a next step → **Save & next lead**.
   - **Expect:** you move to the next lead. Click **End queue**.
7. Go back to the test lead.
   - **Expect:** stage **Interested / Qualified**.

## 3. Get paid with Stripe (15 min)

1. On the test lead, open the **Offers & payments** tab.
2. Under **Stripe customer**, click **Find in Stripe**, then **Create new customer**.
   - **Expect:** it's now linked, with a `cus_…` ID.
3. Click **Create payment link**.
   - Tick **Website Build** and **Website Care**.
   - **Expect:** "Due today $1,599, then $99 every month".
   - Choose **Checkout for this customer** and click **Create link**.
   - **Expect:** stage **Awaiting Payment**, and the link is marked **"Not sent yet"**.
4. Click **Copy**.
   - **Expect:** it still says "Not sent yet" — copying doesn't count as sending.
   - Click **Email it** and send it to your `+lead` address.
   - **Expect:** the link changes to **"Sent — awaiting payment"**.
5. Open the link and pay with the test card `4242 4242 4242 4242`, any future date, any CVC.
   - **Expect:** a "Thank you" page.
   - **Expect:** in the `stripe listen` window, several events each marked `[200]`.
6. Refresh the lead. **Expect:**
   - stage **Won**
   - the payment listed as **"Confirmed by Stripe · Sale"**
   - the recommended step is **"Complete the handoff"**

7. Open the **Notifications** button at the bottom of the sidebar.
   - **Expect:** "Payment received — …". Clicking it opens the handoff tab.

If the lead doesn't change to Won, click **Check payment** on the link. It asks Stripe directly and records the payment if it went through.

## 4. Hand off the client (10 min)
   Handoff info for team needs to be more clear on handoff tab
1. On the **Handoff** tab:
   - **Expect:** the carried-over details are filled in, plus a checklist of needed and later items.
2. Fill in:
   - agreed services
   - target launch date
   - registrar access: "Client has access"
   - a social link
3. Try typing `password: test123` into promised work.
   - **Expect:** it's rejected.
4. Clear it, then click **Mark handoff complete**.
5. Go to **Clients**.
   - **Expect:** the test business is now a client with a project.
   - **Expect:** its **Notes** tab has a "Sales handoff" summary.
6. On the client's **Billing** tab, click **Refresh from Stripe**.
ERROR: Stripe: You cannot expand more than 4 levels of a property. Property: data.items.data.price.product
   - **Expect:** the $1,599 payment, the monthly subscription and the Stripe invoice.
7. Optional, on the client's **Domains** tab or in **Domains**: link one of your Namecheap domains to the project.

## 5. Things that should go wrong safely (10 min)

1. On another lead, create a customer checkout and pay with the declining test card `4000 0000 0000 0002`.
   - **Expect:** the payment fails and the lead stays in **Awaiting Payment** — not Won.
2. Click **Deactivate** on an unpaid link.
   - **Expect:** it can no longer be paid.
3. In the Stripe Dashboard, **refund** the test payment.
   - **Expect:** the lead's payment shows **refunded**.
4. On a different lead, use **⋯ → Mark do not contact**.
   - **Expect:** Call, Text and Email disappear, and the lead drops out of Today and the queue.
5. On another lead, use **Record a payment made outside Stripe** (for example a $500 check).
   - **Expect:** it becomes Won, labelled **"Recorded manually"**.

## 6. Team and permissions (15 min, optional but worth it)

1. **Settings → Team & access → Invite someone**:
   - email: `theofficialwebsiteguys+rep@gmail.com`
   - role: **Sales Representative**
2. Accept the invite from your inbox in a **private browser window** and set a password.
3. As the admin, assign a lead to the rep (lead page → **⋯ → Assign to …**).
   - **Expect (in the rep's window):** a notification count on the Notifications button; clicking it opens the lead.
4. As the rep, check what you see:
   - **Expect:** Dashboard, Today and Reports have **no "Team activity"** option.
   - **Expect:** Settings → Workspace is read-only.
   - **Expect:** a custom-priced item can't be added in the payment-link builder.
5. As the rep, in **Settings → Notifications**, turn off "A lead is assigned to me" and save. Have the admin assign another lead.
   - **Expect:** no notification appears.

## 7. Review the numbers (5 min)

1. **Reports:** tick **"Include demo & Stripe test data"**.
   - **Expect:** attempts by channel, meetings, and paid sales split into Stripe vs manual.
   - **Expect:** Team view shows a row per person.
2. **Dashboard:** switch between My and Team activity and change the period.
   - **Expect:** Needs attention lists items such as waiting replies, overdue follow-ups, failed payments and open handoffs, each linking to the right record.
   - Collected revenue there **excludes Stripe test payments by design**. The manual $500 payment counts; the $1,599 test payment doesn't.

## Optional: texting and calling (Twilio)

Only if you set up Twilio and the tunnel. On a trial account, your phone must be verified in Twilio.

1. **Text** the test lead with your number as its phone.
   - **Expect:** you receive the text, and its status updates to *delivered*.
2. Reply "hi".
   - **Expect:** it shows in the lead's conversations and a notification arrives.
3. Reply "STOP".
   - **Expect:** the lead becomes **Do not contact**.

## Clean up afterwards

- **Leads:** archive the test leads from the ⋯ menu on the Leads page.
- **Stripe:** in the Dashboard, Developers → **Delete all test data** removes the test customers and payments.
- **Test client:** its client record stays in your development database, which is fine for dev.

If something doesn't behave as the **Expect:** line says, note the step number and what you saw, plus any `stripe listen` or API console output.
