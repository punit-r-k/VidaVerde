# Automated Emails

This page explains, in plain English, which emails Vida Verde sends automatically.

## Short Version

Vida Verde currently sends 3 automatic customer emails:

1. Order confirmation
2. Pre-order ready for pickup
3. Friday pickup reminder

Vida Verde does **not** currently send:

- a welcome email after someone joins the email list
- a shipping update email
- an automatic marketing newsletter from this website

## General Rules For All Automated Emails

- These emails only go out if the email system is set up and working.
- If the email system is not set up, the website skips the email instead of crashing.
- These are service emails, not marketing emails.
- The goal is to give customers order and pickup information they need.
- If an order-confirmation email automation fails after payment succeeds, checkout still confirms the order and shows a fallback notice telling the customer how to contact Vida Verde.

## 1. Order Confirmation

### When a customer gets it

- After a paid order has been successfully recorded

### Important rules

- It should only be sent once per order.
- If the customer's email address is missing, it cannot be sent.
- If the order details are incomplete, it cannot be sent.
- If the confirmation email automation has a temporary problem, the paid order still completes and the customer sees a fallback message with support instructions.

### What the email says

- Thank you for your order
- Your order number or receipt details
- Whether the order is for shipping or market pickup
- A list of what was purchased
- The subtotal, tax, shipping, and total
- The shipping address, if it is a shipping order
- The pickup details, if it is a market pickup order
- A downloadable calendar file for market pickup orders with an assigned pickup date
- A support text number in case the customer has questions

### Special note for pre-orders

If the order contains pre-order items, the email explains that clearly:

- If everything is still a pre-order, it explains that a pickup date is not assigned yet.
- If everything is still a pre-order, the calendar file waits until a pickup date is actually assigned.
- If the order is mixed, it explains which items are ready now and which items will be ready later.
- The calendar file for mixed pickup orders includes both the ready-now items and the items still not ready.

### Design

- This email uses the main Vida Verde email banner.

## 2. Pre-Order Ready For Pickup

### When a customer gets it

- When a restock makes their pre-ordered pickup items ready

This can happen on **any day of the week**. It is **not** limited to Fridays.

### Important rules

- It is only for paid orders.
- It is only for market pickup orders.
- It is only sent for pre-order items that have just become ready.
- The system marks each release so the same release alert is not sent twice.
- If the customer still has other pre-order items that are not ready yet, the email says more updates will come later.

### What the email says

- Great news that pre-ordered items are now ready
- Which items just became ready
- Sometimes the customer's full pickup list for that order, if other items were already ready earlier
- Any preorder items from the same order that are still not ready yet
- The market name
- The pickup day
- The market address
- The pickup window
- A downloadable calendar file for the full Saturday pickup window that includes ready and not-ready item notes
- A reminder to text if they cannot make pickup

### Design

- This email now uses the main Vida Verde email banner.

## 3. Friday Pickup Reminder

### When a customer gets it

- On Friday around 12pm Central Time
- It reminds them to pick up their order on Saturday

This reminder can also be sent manually by the team if needed.

### Important rules

- It is only for paid orders.
- It is only for market pickup orders.
- It is only for items that are already ready for the coming Saturday.
- It is meant to be a reminder, not the first announcement that an order exists.
- Standard pickup orders placed on Friday are intentionally excluded from this reminder so customers do not get a too-soon duplicate message.
- This Friday reminder is separate from the "pre-order ready for pickup" email.

### What the email says

- A reminder that pickup is tomorrow
- The customer's pickup list
- Any items from the same order that are still not ready for tomorrow's pickup
- The market name
- The pickup date
- The market address
- The pickup window
- A downloadable calendar file for the full Saturday pickup window that includes ready and not-ready item notes
- Simple reminder notes about pickup
- A reminder to text if they cannot make pickup

### Design

- This email uses the same main Vida Verde email banner as the order confirmation email.

## What Vida Verde Does Not Email Right Now

The website stores email signups, but it does not automatically send a welcome email after signup.

The website also tracks orders and shipments, but it does not currently send:

- shipping confirmation emails
- tracking emails
- delivery emails

## One-Page Summary

| Email | When it sends | Main purpose |
| --- | --- | --- |
| Order confirmation | Right after a paid order is successfully recorded | Confirms the purchase and shows the order details |
| Pre-order ready for pickup | Whenever a restock makes preorder pickup items ready | Tells the customer their pre-order is now ready |
| Friday pickup reminder | Friday at about 12pm Central Time | Reminds the customer to pick up on Saturday |

## If You Want The Simplest Possible Mental Model

- Order confirmation = "We got your paid order."
- Pre-order ready for pickup = "Your delayed item is ready now."
- Friday pickup reminder = "Do not forget to come tomorrow."
