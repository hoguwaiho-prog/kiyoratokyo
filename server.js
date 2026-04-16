'use strict';

require('dotenv').config();

const express = require('express');
const cors    = require('cors');
const stripe  = require('stripe')(process.env.STRIPE_SECRET_KEY);

const app  = express();
const PORT = process.env.PORT || 3000;

// ── Middleware ──────────────────────────────────────────────
app.use(cors());
app.use(express.json());
app.use(express.static(__dirname)); // serves index.html, clinics.json, etc.

// ── Health check ────────────────────────────────────────────
app.get('/health', (_req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// ── POST /create-checkout-session ───────────────────────────
// Creates a Stripe Checkout session in "authorize only" mode.
// The deposit is authorized but NOT captured until the booking
// is confirmed with the clinic (capture_method: 'manual').
app.post('/create-checkout-session', async (req, res) => {
  const { clinicId, clinicName, slots, amount = 10000 } = req.body;

  if (!clinicName || !Array.isArray(slots) || slots.length === 0) {
    return res.status(400).json({ error: 'clinicName and slots are required.' });
  }

  // Format slot strings for the Stripe product description
  const slotLines = slots
    .filter(s => s.date)
    .map(s => `${s.choice}: ${s.date}${s.time ? ' · ' + s.time : ''}`)
    .join(' | ');

  try {
    const session = await stripe.checkout.sessions.create({
      payment_method_types: ['card'],
      line_items: [{
        price_data: {
          currency: 'jpy',
          product_data: {
            name: `Booking Deposit — ${clinicName}`,
            description: `Preferred slots: ${slotLines}`,
            metadata: { clinic_id: String(clinicId ?? ''), slots: slotLines },
          },
          unit_amount: amount, // JPY is zero-decimal, so 10000 = ¥10,000
        },
        quantity: 1,
      }],
      mode: 'payment',
      // Authorize now; capture manually once the clinic confirms a slot.
      // Call stripe.paymentIntents.capture(paymentIntentId) from your
      // admin/webhook flow to finalize the charge.
      payment_intent_data: {
        capture_method: 'manual',
        metadata: {
          clinic_id:   String(clinicId ?? ''),
          clinic_name: clinicName,
          slots:       slotLines,
        },
      },
      success_url: `${process.env.DOMAIN}/success.html?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url:  `${process.env.DOMAIN}/cancel.html`,
    });

    console.log(`[Kiyora] Checkout session created: ${session.id} | clinic: ${clinicName}`);
    res.json({ id: session.id });

  } catch (err) {
    console.error('[Kiyora] Stripe error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── POST /capture-payment ────────────────────────────────────
// Call this from your admin dashboard once the clinic confirms.
// Body: { paymentIntentId }
app.post('/capture-payment', async (req, res) => {
  const { paymentIntentId } = req.body;
  if (!paymentIntentId) {
    return res.status(400).json({ error: 'paymentIntentId is required.' });
  }
  try {
    const intent = await stripe.paymentIntents.capture(paymentIntentId);
    console.log(`[Kiyora] Captured payment: ${intent.id} (¥${intent.amount_received})`);
    res.json({ status: intent.status, amount_captured: intent.amount_received });
  } catch (err) {
    console.error('[Kiyora] Capture error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── POST /cancel-payment ─────────────────────────────────────
// Call this to fully release the authorization (full refund).
// Body: { paymentIntentId }
app.post('/cancel-payment', async (req, res) => {
  const { paymentIntentId } = req.body;
  if (!paymentIntentId) {
    return res.status(400).json({ error: 'paymentIntentId is required.' });
  }
  try {
    const intent = await stripe.paymentIntents.cancel(paymentIntentId);
    console.log(`[Kiyora] Cancelled/released authorization: ${intent.id}`);
    res.json({ status: intent.status });
  } catch (err) {
    console.error('[Kiyora] Cancel error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

app.listen(PORT, () => {
  console.log(`[Kiyora Tokyo] Server running → http://localhost:${PORT}`);
  if (!process.env.STRIPE_SECRET_KEY) {
    console.warn('[Kiyora] WARNING: STRIPE_SECRET_KEY is not set. Copy .env.example to .env.');
  }
});
