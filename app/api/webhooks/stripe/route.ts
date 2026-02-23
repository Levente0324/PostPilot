import { NextResponse } from "next/server";
import { headers } from "next/headers";
import Stripe from "stripe";
import { createClient } from "@supabase/supabase-js";

export async function POST(req: Request) {
  try {
    const stripeSecretKey = process.env.STRIPE_SECRET_KEY;
    if (!stripeSecretKey) {
      console.warn(
        "⚠️ STRIPE_SECRET_KEY is not set. Webhook handler cannot proceed.",
      );
      return new NextResponse("STRIPE_SECRET_KEY is not set", { status: 500 });
    }

    const stripe = new Stripe(stripeSecretKey, {
      apiVersion: "2026-01-28.clover",
    });

    const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
    if (!webhookSecret) {
      console.warn(
        "⚠️ STRIPE_WEBHOOK_SECRET is not set. Webhook handler cannot proceed.",
      );
      return new NextResponse("STRIPE_WEBHOOK_SECRET is not set", {
        status: 500,
      });
    }

    const supabaseAdmin = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL || "http://localhost:3000",
      process.env.SUPABASE_SERVICE_ROLE_KEY || "none",
    );

    const body = await req.text();
    const signature = (await headers()).get("stripe-signature") as string;

    let event: Stripe.Event;

    try {
      event = stripe.webhooks.constructEvent(body, signature, webhookSecret);
    } catch (err: any) {
      console.error(`Webhook Error: ${err.message}`);
      return new NextResponse(`Webhook Error: ${err.message}`, { status: 400 });
    }

    switch (event.type) {
      case "checkout.session.completed": {
        const session = event.data.object as Stripe.Checkout.Session;
        const customerId = session.customer as string;
        const subscriptionId = session.subscription as string;

        // Retrieve subscription details
        const subscription =
          await stripe.subscriptions.retrieve(subscriptionId);
        const planId = subscription.items.data[0].price.id;

        // Determine plan based on price ID (you'd map these in a real app)
        let plan = "pro";
        let limit = 40;

        if (planId === process.env.STRIPE_BUSINESS_PRICE_ID) {
          plan = "business";
          limit = 999999; // Unlimited
        }

        await supabaseAdmin
          .from("profiles")
          .update({
            subscription_status: "active",
            plan: plan,
            monthly_post_limit: limit,
          })
          .eq("stripe_customer_id", customerId);
        break;
      }
      case "customer.subscription.updated": {
        const subscription = event.data.object as Stripe.Subscription;
        const customerId = subscription.customer as string;

        await supabaseAdmin
          .from("profiles")
          .update({
            subscription_status: subscription.status,
          })
          .eq("stripe_customer_id", customerId);
        break;
      }
      case "customer.subscription.deleted": {
        const subscription = event.data.object as Stripe.Subscription;
        const customerId = subscription.customer as string;

        await supabaseAdmin
          .from("profiles")
          .update({
            subscription_status: "inactive",
            plan: "free",
            monthly_post_limit: 10,
          })
          .eq("stripe_customer_id", customerId);
        break;
      }
    }

    return new NextResponse(null, { status: 200 });
  } catch (error: any) {
    console.error("Webhook handler failed:", error);
    return new NextResponse("Internal Server Error", { status: 500 });
  }
}
