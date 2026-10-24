/**
 * ═══════════════════════════════════════════════════════════════════
 *  Shri Ranchhodji Mandir, Matar — Cashfree Payment Backend
 *  server.js — Node.js + Express
 * ═══════════════════════════════════════════════════════════════════
 *
 *  SETUP INSTRUCTIONS:
 *  1. Copy .env.example → .env and fill in your credentials
 *  2. Run: npm install
 *  3. Run: npm start (or configure via IIS + iisnode / PM2)
 *
 *  CASHFREE ACCOUNT SIGNUP:
 *  → https://merchant.cashfree.com/merchants/signup
 *  → Business Type: Trust / NGO / Religious Institution
 *  → Documents: Trust deed, PAN, Bank passbook
 *  → After KYC: Dashboard → Developers → API Keys
 *
 *  PRICING:
 *  → 0% fees up to ₹20 Lakh GMV (new merchant promo)
 *  → 1.95% + GST after that
 *  → Settlements in T+1 to T+2 business days
 * ═══════════════════════════════════════════════════════════════════
 */

require('dotenv').config();
const express = require('express');
const cors    = require('cors');
const path    = require('path');
const crypto  = require('crypto');
const { Cashfree, CFEnvironment } = require('cashfree-pg');

const app = express();

// ─── Middleware ───────────────────────────────────────────────────────────────
// Keep raw body for webhook verification
app.use(express.json({
    verify: (req, res, buf) => {
        req.rawBody = buf;
    }
}));
app.use(express.urlencoded({ extended: true }));

// Serve static files (index.html, payment-status.html, images, video)
app.use(express.static(path.join(__dirname)));

// CORS — allow requests from your own domain only
app.use(cors({
    origin: process.env.SITE_URL || '*',
    methods: ['GET', 'POST']
}));

// ─── Helper: Validate Environment ────────────────────────────────────────────
function checkConfig() {
    const appId = process.env.CASHFREE_APP_ID;
    const secret = process.env.CASHFREE_SECRET_KEY;
    if (!appId || appId === 'YOUR_APP_ID_HERE') {
        return false;
    }
    if (!secret || secret === 'YOUR_SECRET_KEY_HERE') {
        return false;
    }
    return true;
}

// ─── Cashfree Client Factory ──────────────────────────────────────────────────
function getCashfreeClient() {
    const isProd = (process.env.CASHFREE_ENV === 'production');
    const env = isProd ? CFEnvironment.PRODUCTION : CFEnvironment.SANDBOX;
    const appId = process.env.CASHFREE_APP_ID || '';
    const secret = process.env.CASHFREE_SECRET_KEY || '';

    return new Cashfree(env, appId, secret);
}

// ─── API: Config (for frontend mode detection) ────────────────────────────────
app.get('/api/config', (req, res) => {
    res.json({
        env: (process.env.CASHFREE_ENV === 'production') ? 'production' : 'sandbox',
        configured: checkConfig()
    });
});

// ─── API: Create Order ────────────────────────────────────────────────────────
/**
 * POST /api/create-order
 * Body: { amount: number (in INR), donorName?: string, donorPhone?: string, donorEmail?: string }
 * Returns: { order_id, payment_session_id, order_status }
 */
app.post('/api/create-order', async (req, res) => {
    if (!checkConfig()) {
        console.error('❌ Cannot create order: Cashfree credentials not configured in .env');
        return res.status(503).json({
            error: 'Payment gateway not configured. Please set CASHFREE_APP_ID and CASHFREE_SECRET_KEY in your .env file.'
        });
    }

    const { amount, donorName, donorPhone, donorEmail } = req.body;

    // Validate amount
    const parsedAmount = parseFloat(amount);
    if (isNaN(parsedAmount) || parsedAmount < 1) {
        return res.status(400).json({ error: 'Invalid amount. Minimum donation is ₹1.' });
    }

    // Generate a unique order ID
    const orderId = 'MANDIR_' + Date.now() + '_' + crypto.randomBytes(4).toString('hex').toUpperCase();

    // Determine return URL
    const siteUrl = (process.env.SITE_URL || '').trim().replace(/\/+$/, '');
    const returnUrl = siteUrl
        ? `${siteUrl}/payment-status.html?order_id={order_id}`
        : `http://localhost:${process.env.PORT || 3000}/payment-status.html?order_id={order_id}`;

    const notifyUrl = siteUrl ? `${siteUrl}/api/webhook` : undefined;

    // Sanitize customer phone (Cashfree requires a 10-digit number)
    let cleanPhone = (donorPhone || '').replace(/\D/g, '');
    if (cleanPhone.length > 10) cleanPhone = cleanPhone.slice(-10);
    if (cleanPhone.length !== 10) cleanPhone = '9999999999';

    const orderRequest = {
        order_id:       orderId,
        order_amount:   parsedAmount.toFixed(2),
        order_currency: 'INR',
        order_note:     'Seva / Donation — Shri Ranchhodji Mandir, Matar',

        customer_details: {
            customer_id:    'DONOR_' + Date.now(),
            customer_name:  (donorName && donorName.trim()) || 'Devotee',
            customer_email: (donorEmail && donorEmail.trim()) || 'donor@shreeranchhodjimandir.org',
            customer_phone: cleanPhone
        },

        order_meta: {
            return_url: returnUrl,
            ...(notifyUrl ? { notify_url: notifyUrl } : {})
        }
    };

    try {
        const cf = getCashfreeClient();
        const response = await cf.PGCreateOrder(orderRequest);
        const data = response.data;

        console.log(`✅ Order created: ${orderId} | ₹${parsedAmount}`);

        res.json({
            order_id:           data.order_id,
            payment_session_id: data.payment_session_id,
            order_status:       data.order_status
        });

    } catch (err) {
        const msg = err.response?.data?.message || err.message;
        console.error('❌ Cashfree order error:', msg);
        res.status(500).json({ error: 'Could not create payment order: ' + msg });
    }
});

// ─── API: Verify Payment ──────────────────────────────────────────────────────
/**
 * POST /api/verify-payment
 * Body: { order_id: string }
 * Returns: payment status details
 */
app.post('/api/verify-payment', async (req, res) => {
    const { order_id } = req.body;

    if (!order_id) {
        return res.status(400).json({ error: 'order_id is required.' });
    }

    try {
        const cf = getCashfreeClient();
        const response = await cf.PGOrderFetchPayments(order_id);
        const payments = response.data;

        if (!Array.isArray(payments) || payments.length === 0) {
            return res.json({
                status:   'PENDING',
                order_id: order_id,
                message:  'No payment records found yet for this order.'
            });
        }

        // Find any successful payment
        const successful = payments.find(p => p.payment_status === 'SUCCESS');

        if (successful) {
            return res.json({
                status:     'SUCCESS',
                payment_id: successful.cf_payment_id,
                amount:     successful.order_amount,
                method:     successful.payment_method,
                order_id:   order_id
            });
        }

        const latest = payments[payments.length - 1];
        res.json({
            status:   latest?.payment_status || 'FAILED',
            order_id: order_id,
            message:  'Payment not completed.'
        });

    } catch (err) {
        const msg = err.response?.data?.message || err.message;
        console.error('❌ Verify payment error:', msg);
        res.status(500).json({ error: 'Could not verify payment: ' + msg });
    }
});

// ─── API: Webhook (Cashfree server-to-server confirmation) ────────────────────
app.post('/api/webhook', (req, res) => {
    try {
        const signature = req.headers['x-webhook-signature'];
        const timestamp = req.headers['x-webhook-timestamp'];
        const rawBody   = req.rawBody ? req.rawBody.toString('utf8') : JSON.stringify(req.body);

        if (!signature || !timestamp) {
            return res.status(400).json({ error: 'Missing webhook signature headers' });
        }

        const cf = getCashfreeClient();
        const webhookEvent = cf.PGVerifyWebhookSignature(signature, rawBody, timestamp);

        const type = webhookEvent.type;
        const data = webhookEvent.data;

        if (type === 'PAYMENT_SUCCESS_WEBHOOK') {
            console.log(`✅ Webhook: Payment SUCCESS | Order: ${data?.order?.order_id} | ₹${data?.order?.order_amount}`);
            // Can be extended to send SMS/Email or store in database
        } else if (type === 'PAYMENT_FAILED_WEBHOOK') {
            console.log(`❌ Webhook: Payment FAILED | Order: ${data?.order?.order_id}`);
        }

        res.status(200).json({ status: 'ok' });

    } catch (err) {
        console.error('❌ Webhook error:', err.message);
        res.status(400).json({ error: 'Webhook signature verification failed: ' + err.message });
    }
});

// ─── Health Check ─────────────────────────────────────────────────────────────
app.get('/api/health', (req, res) => {
    res.json({
        status:     'ok',
        env:        process.env.CASHFREE_ENV || 'sandbox',
        siteUrl:    process.env.SITE_URL || 'not set',
        configured: checkConfig()
    });
});

// ─── Fallback: Single-Page Application / Index Routing ────────────────────────
app.get('*', (req, res, next) => {
    if (req.path.startsWith('/api/')) return next();
    res.sendFile(path.join(__dirname, 'index.html'));
});

// ─── Start Server ─────────────────────────────────────────────────────────────
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log('');
    console.log('🛕  Shri Ranchhodji Mandir — Cashfree Payment Server');
    console.log('═══════════════════════════════════════════════════');
    console.log(`✅  Server running on port ${PORT}`);
    console.log(`🌐  Site URL:  ${process.env.SITE_URL || 'http://localhost:' + PORT}`);
    console.log(`💳  Cashfree:  ${process.env.CASHFREE_ENV || 'sandbox'} mode`);
    console.log(`🔑  App ID:    ${checkConfig() ? '✅ Configured' : '❌ NOT CONFIGURED (Edit .env file)'}`);
    console.log('═══════════════════════════════════════════════════');
    console.log(`📋  Health:    http://localhost:${PORT}/api/health`);
    console.log('');
});
