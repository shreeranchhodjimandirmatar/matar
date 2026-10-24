# 🛕 Razorpay Integration Plan — Shri Ranchhodji Mandir, Matar

## Overview

Integrate Razorpay as a free online payment gateway into the existing static donation website hosted on GitHub Pages.

---

## 🧠 Key Constraint: GitHub Pages = Static Only

GitHub Pages **cannot run any backend server** (Node.js, PHP, Python, etc.). This has a direct impact on how Razorpay can be used:

| Approach | Works on GitHub Pages? | Security | Effort |
|---|---|---|---|
| UPI Deep Link (current) | ✅ Yes | ✅ Safe | Done |
| Razorpay Payment Links | ✅ Yes | ✅ Best | Low |
| Razorpay Checkout.js (client-only, no `order_id`) | ✅ Yes | ⚠️ Donations-OK | Medium |
| Razorpay Checkout.js with `order_id` (full flow) | ❌ Needs backend | ✅ Best | High |

> **Chosen Approach: Razorpay Checkout.js (client-side, no `order_id`)**  
> For a donation/charity use case, skipping `order_id` is acceptable.  
> The **Key ID** (public) is safe to embed in HTML. Only the **Key Secret** must never be exposed — and we won't use it at all on the frontend.

---

## 🗺️ Architecture

```
User (Browser)
    │
    ▼
GitHub Pages (index.html)
    │  1. User clicks "Donate via Razorpay"
    │  2. Enters amount in modal
    │  3. JS calls Razorpay Checkout.js popup
    ▼
Razorpay Checkout Popup (hosted by Razorpay)
    │  4. User pays via UPI / Card / Netbanking / Wallet
    ▼
Razorpay Dashboard (temple's account)
    │  5. Payment captured automatically
    │  6. Settlement to bank account
    ▼
Payment Success Handler (client-side JS)
    │  7. Show custom "Thank You" message on page
```

---

## 📋 Step-by-Step Plan

### Phase 1 — Razorpay Account Setup (Manual — You Do This)
1. **Sign up for free** at [https://dashboard.razorpay.com/signup](https://dashboard.razorpay.com/signup)
2. Complete **KYC** with temple trust documents (PAN, GST optional, bank account)
3. Navigate to **Settings → API Keys** → Generate **Test API Key** first
4. After testing is complete, activate your account and generate a **Live API Key**
5. Note down: **Key ID** (starts with `rzp_live_...`) — this is the only key needed in the frontend

> **Razorpay Pricing:** Free to sign up. They charge **2% per transaction** (standard). No monthly fee.

---

### Phase 2 — Code Changes to `index.html`

#### 2a. Add Razorpay Script Tag
```html
<script src="https://checkout.razorpay.com/v1/checkout.js"></script>
```

#### 2b. Update the "Donate" Button Flow
The existing modal (amount selection popup) already exists. We only need to:
- Replace the `proceedToPay()` function's UPI deep link logic
- Add a new Razorpay checkout call

#### 2c. New `proceedToPay()` Function
```javascript
function proceedToPay() {
    let val = parseFloat(inputField.value);
    if (isNaN(val) || val < 1) { val = 1; }

    const options = {
        key: "rzp_live_YOUR_KEY_ID",     // Replace with your Key ID
        amount: Math.round(val * 100),    // Razorpay uses paise (₹1 = 100 paise)
        currency: "INR",
        name: "Shri Ranchhodji Mandir, Matar",
        description: "Donation / Seva",
        image: "https://YOUR_GITHUB_USERNAME.github.io/shreeranchhodjimandir/MatarTemple.jpeg",
        handler: function (response) {
            // Payment successful — show thank you screen
            showThankYou(response.razorpay_payment_id, val);
            closeModal();
        },
        prefill: {
            name: "",
            email: "",
            contact: ""
        },
        notes: {
            purpose: "Temple Donation"
        },
        theme: {
            color: "#FF7E27"  // Match the brand orange
        },
        modal: {
            ondismiss: function() {
                // User closed the Razorpay popup without paying
                console.log("Payment cancelled");
            }
        }
    };

    const rzp = new Razorpay(options);
    rzp.open();
    closeModal();
}
```

#### 2d. Add a "Thank You" screen
After successful payment, show a beautiful animated confirmation message instead of just `alert()`.

---

### Phase 3 — Keep UPI as Fallback (Important!)
Many rural donors may not have cards/netbanking. We should:
- **Keep the existing UPI deep link** as a secondary option
- Add a tab/toggle in the donation modal: **"Pay via Razorpay"** | **"Pay via UPI App"**

---

### Phase 4 — GitHub Pages Deployment
1. Ensure `index.html` is at the **root** of the repository (already done ✅)
2. Go to your GitHub repository → **Settings → Pages**
3. Set **Source**: `Deploy from a branch`
4. Set **Branch**: `main` (or `master`), folder `/root`
5. Your site will be live at:  
   `https://YOUR_GITHUB_USERNAME.github.io/shreeranchhodjimandir/`

> **Image/Video paths:** Since the site is at a sub-path (`/shreeranchhodjimandir/`), the `MatarTemple.jpeg` and `MatarTemple.mp4` relative paths in the HTML should work correctly as long as those files are pushed to the repository.

---

### Phase 5 — Testing
1. Use **Test API Key** (`rzp_test_...`) during development
2. Test with Razorpay's test card: `4111 1111 1111 1111`, any future date, any CVV
3. Verify payments appear in your **Razorpay Test Dashboard**
4. Switch to **Live API Key** (`rzp_live_...`) before final deployment

---

## 📁 File Changes Summary

| File | Change |
|---|---|
| `index.html` | Add Razorpay script, update `proceedToPay()`, add tabs for UPI/Razorpay, add thank-you screen |
| No new files needed | Everything is self-contained in `index.html` |

---

## ⚠️ Important Notes

- **Never commit your Key Secret** to GitHub — only the Key ID is used in frontend code.
- The Key ID (e.g., `rzp_live_xxx`) is **safe** to be public/visible in HTML source.
- For **donations** (charity use case), Razorpay does NOT require `order_id`, making full static hosting feasible.
- Razorpay supports: UPI, Credit/Debit Cards, Net Banking, Wallets — much broader than UPI-only.

---

## ✅ Approval Needed Before Implementation

Please confirm:
1. Do you have a Razorpay account, or should we include account setup instructions in the code comments?
2. Should we **keep the UPI deep link as a fallback** or replace it entirely with Razorpay?
3. What is your **GitHub username** (needed for the correct image URL in Razorpay checkout popup)?
