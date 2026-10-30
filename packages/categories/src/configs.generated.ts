// Generated from configs/*.yaml by scripts/gen.ts. Do not edit by hand.
import type { CategoryConfig } from '@receipts/core';

export const CATEGORY_CONFIGS: CategoryConfig[] = [
  {
    "category": "agents_apis",
    "name": "Agents and APIs",
    "rails": [
      "onchain_payment"
    ],
    "aspects": [
      "accuracy",
      "latency",
      "uptime",
      "price"
    ],
    "followups": [
      "30d"
    ],
    "item_noun": "api",
    "recency_days": 30,
    "decay_half_life_days": 60,
    "min_receipts_to_rank": 3,
    "publish": {
      "level": "item",
      "delay": "none",
      "date_granularity": "day",
      "redact_booking_refs": false
    },
    "moderation": {
      "personal_allegations": "allow",
      "fake_product_claims": "allow"
    },
    "item_must_be_in_proof": false,
    "rate_platform_separately": false,
    "erc8004": true,
    "rules": [
      "The payment transaction is the receipt.",
      "Also written as ERC-8004 feedback."
    ],
    "prompt": {
      "en": "Which API or agent did you pay, and did it deliver? Accuracy, latency, uptime, price.",
      "hi": "आपने किस API या एजेंट को भुगतान किया और क्या उसने काम किया? सटीकता, गति, अपटाइम, कीमत।"
    },
    "keywords": [
      "api",
      "agent",
      "x402",
      "mcp",
      "endpoint",
      "llm",
      "model",
      "tool",
      "inference"
    ]
  },
  {
    "category": "food",
    "name": "Food (delivery and dine-in)",
    "rails": [
      "order_page",
      "order_email",
      "payment_proof",
      "merchant_receipt",
      "network_order"
    ],
    "aspects": [
      "taste",
      "portion",
      "value",
      "delivery_time",
      "packaging",
      "hygiene"
    ],
    "followups": [
      "1d"
    ],
    "item_noun": "dish",
    "recency_days": 30,
    "decay_half_life_days": 90,
    "min_receipts_to_rank": 3,
    "publish": {
      "level": "item",
      "delay": "random_0_24h",
      "date_granularity": "day",
      "redact_booking_refs": false
    },
    "moderation": {
      "personal_allegations": "allow",
      "fake_product_claims": "allow"
    },
    "item_must_be_in_proof": true,
    "rate_platform_separately": false,
    "erc8004": false,
    "rules": [
      "The dish must be in the proven order.",
      "Small restaurants publish after a random 0-24 hour delay so timing cannot single out the reviewer."
    ],
    "prompt": {
      "en": "What did you order and how was it? Taste, portion, price, delivery.",
      "hi": "आपने क्या ऑर्डर किया और कैसा लगा? स्वाद, मात्रा, दाम, डिलीवरी।"
    },
    "keywords": [
      "biryani",
      "dosa",
      "idli",
      "pizza",
      "burger",
      "thali",
      "restaurant",
      "food",
      "cafe",
      "café",
      "dinner",
      "lunch",
      "breakfast",
      "dish",
      "curry",
      "fish",
      "seafood",
      "prawn",
      "shack",
      "chicken",
      "paneer",
      "coffee",
      "vindaloo",
      "xacuti",
      "bebinca",
      "momos",
      "noodles",
      "rolls"
    ]
  },
  {
    "category": "groceries",
    "name": "Groceries and quick commerce",
    "rails": [
      "order_email",
      "order_page",
      "payment_proof"
    ],
    "aspects": [
      "freshness",
      "accuracy",
      "substitutions",
      "delivery_time"
    ],
    "followups": [
      "1d"
    ],
    "item_noun": "store",
    "recency_days": 14,
    "decay_half_life_days": 60,
    "min_receipts_to_rank": 3,
    "publish": {
      "level": "merchant",
      "delay": "none",
      "date_granularity": "day",
      "redact_booking_refs": false
    },
    "moderation": {
      "personal_allegations": "allow",
      "fake_product_claims": "allow"
    },
    "item_must_be_in_proof": false,
    "rate_platform_separately": true,
    "erc8004": false,
    "rules": [
      "The store and the platform are rated separately."
    ],
    "prompt": {
      "en": "How was the order? Freshness, missing items, substitutions, delivery time.",
      "hi": "ऑर्डर कैसा रहा? ताज़गी, कोई सामान छूटा, बदला गया सामान, डिलीवरी का समय।"
    },
    "keywords": [
      "grocery",
      "groceries",
      "blinkit",
      "zepto",
      "instamart",
      "bigbasket",
      "vegetables",
      "fruits",
      "milk",
      "essentials",
      "quick commerce",
      "dark store"
    ]
  },
  {
    "category": "landlords",
    "name": "Landlords and rentals",
    "rails": [
      "payment_proof",
      "order_email"
    ],
    "aspects": [
      "maintenance",
      "deposit_return",
      "honesty",
      "house_rules",
      "neighbourhood"
    ],
    "followups": [
      "180d",
      "move_out"
    ],
    "item_noun": "building",
    "recency_days": 120,
    "decay_half_life_days": 365,
    "min_receipts_to_rank": 3,
    "min_proof": {
      "payments": 3,
      "span_months": 3
    },
    "publish": {
      "level": "building",
      "delay": "until_move_out_or_90d",
      "date_granularity": "week",
      "redact_booking_refs": false
    },
    "moderation": {
      "personal_allegations": "hold_for_review",
      "fake_product_claims": "allow"
    },
    "item_must_be_in_proof": false,
    "rate_platform_separately": false,
    "erc8004": false,
    "rules": [
      "Published at building level after move-out or a delay, so tenants are safe from retaliation.",
      "Landlords can reply in public.",
      "Accusations about a person are held for human review."
    ],
    "prompt": {
      "en": "How is renting here? Maintenance, deposit, honesty, house rules, neighbourhood. Talk about the experience, not the person.",
      "hi": "यहाँ किराये पर रहना कैसा है? रखरखाव, डिपॉज़िट, ईमानदारी, नियम, आस-पड़ोस। अनुभव के बारे में बताइए।"
    },
    "keywords": [
      "landlord",
      "rent",
      "flat",
      "apartment",
      "pg",
      "deposit",
      "tenant",
      "lease",
      "building",
      "rental"
    ]
  },
  {
    "category": "local_services",
    "name": "Local services (salons, repairs, tutors, gyms, rentals)",
    "rails": [
      "payment_proof",
      "merchant_receipt"
    ],
    "aspects": [
      "result",
      "punctuality",
      "honest_pricing",
      "behaviour"
    ],
    "followups": [
      "7d",
      "30d"
    ],
    "item_noun": "service",
    "recency_days": 30,
    "decay_half_life_days": 180,
    "min_receipts_to_rank": 3,
    "publish": {
      "level": "merchant",
      "delay": "random_0_24h",
      "date_granularity": "week",
      "redact_booking_refs": false
    },
    "moderation": {
      "personal_allegations": "allow",
      "fake_product_claims": "allow"
    },
    "item_must_be_in_proof": false,
    "rate_platform_separately": false,
    "erc8004": false,
    "rules": [
      "Day 30 asks whether the repair held."
    ],
    "prompt": {
      "en": "What service did you get and how did it go? Result, punctuality, honest pricing, behaviour.",
      "hi": "आपने कौन सी सेवा ली और कैसी रही? नतीजा, समय पर, सही दाम, व्यवहार।"
    },
    "keywords": [
      "salon",
      "haircut",
      "barber",
      "repair",
      "plumber",
      "electrician",
      "tutor",
      "gym",
      "spa",
      "massage",
      "laundry",
      "scooter rental",
      "bike rental",
      "scooter",
      "tailor",
      "mechanic",
      "service"
    ]
  },
  {
    "category": "products",
    "name": "Products (electronics, fashion, beauty, home)",
    "rails": [
      "order_page",
      "order_email",
      "shop_through"
    ],
    "aspects": [
      "quality",
      "as_described",
      "size_fit",
      "durability",
      "returns"
    ],
    "followups": [
      "30d",
      "90d"
    ],
    "item_noun": "product",
    "recency_days": 60,
    "decay_half_life_days": 365,
    "min_receipts_to_rank": 3,
    "publish": {
      "level": "item",
      "delay": "none",
      "date_granularity": "day",
      "redact_booking_refs": false
    },
    "moderation": {
      "personal_allegations": "allow",
      "fake_product_claims": "hold_for_review"
    },
    "item_must_be_in_proof": true,
    "rate_platform_separately": false,
    "erc8004": false,
    "rules": [
      "Match the exact variant.",
      "Fake-product claims go to moderation."
    ],
    "prompt": {
      "en": "Which product did you buy and how is it holding up? Quality, as described, fit, returns.",
      "hi": "आपने कौन सा प्रोडक्ट खरीदा और वह कैसा है? क्वालिटी, जैसा बताया था वैसा, साइज़, रिटर्न।"
    },
    "keywords": [
      "power bank",
      "powerbank",
      "phone",
      "mobile",
      "laptop",
      "headphones",
      "earbuds",
      "charger",
      "cable",
      "shoes",
      "sneakers",
      "shirt",
      "kurta",
      "dress",
      "jeans",
      "cream",
      "serum",
      "sunscreen",
      "mixer",
      "kettle",
      "product",
      "watch",
      "bag",
      "backpack"
    ]
  },
  {
    "category": "subscriptions",
    "name": "Subscriptions and apps",
    "rails": [
      "order_email",
      "payment_proof"
    ],
    "aspects": [
      "reliability",
      "support",
      "value",
      "ease_of_cancelling"
    ],
    "followups": [
      "30d",
      "renewal"
    ],
    "item_noun": "plan",
    "recency_days": 60,
    "decay_half_life_days": 180,
    "min_receipts_to_rank": 3,
    "publish": {
      "level": "item",
      "delay": "none",
      "date_granularity": "day",
      "redact_booking_refs": false
    },
    "moderation": {
      "personal_allegations": "allow",
      "fake_product_claims": "allow"
    },
    "item_must_be_in_proof": true,
    "rate_platform_separately": false,
    "erc8004": false,
    "rules": [],
    "prompt": {
      "en": "Which plan do you pay for and is it worth it? Reliability, support, value, cancelling.",
      "hi": "आप कौन सा प्लान लेते हैं और क्या वह पैसे के लायक है? भरोसा, सपोर्ट, कीमत, कैंसल करना।"
    },
    "keywords": [
      "subscription",
      "netflix",
      "spotify",
      "prime",
      "hotstar",
      "youtube premium",
      "app",
      "saas",
      "plan",
      "membership",
      "cancel"
    ]
  },
  {
    "category": "travel",
    "name": "Travel (flights, trains, buses, hotels, cabs)",
    "rails": [
      "order_email",
      "order_page"
    ],
    "aspects": [
      "punctuality",
      "cleanliness",
      "staff",
      "safety",
      "value"
    ],
    "followups": [
      "trip_end"
    ],
    "item_noun": "trip or stay",
    "recency_days": 60,
    "decay_half_life_days": 180,
    "min_receipts_to_rank": 3,
    "publish": {
      "level": "item",
      "delay": "after_travel_date",
      "date_granularity": "day",
      "redact_booking_refs": true
    },
    "moderation": {
      "personal_allegations": "allow",
      "fake_product_claims": "allow"
    },
    "item_must_be_in_proof": true,
    "rate_platform_separately": false,
    "erc8004": false,
    "rules": [
      "Never publish booking IDs or PNRs.",
      "Reviews open after the travel date."
    ],
    "prompt": {
      "en": "How was the trip or the stay? Punctuality, cleanliness, staff, safety, value.",
      "hi": "यात्रा या ठहरना कैसा रहा? समय पर, सफ़ाई, स्टाफ़, सुरक्षा, कीमत।"
    },
    "keywords": [
      "hotel",
      "stay",
      "resort",
      "airbnb",
      "villa",
      "hostel",
      "homestay",
      "room",
      "flight",
      "airline",
      "indigo",
      "train",
      "irctc",
      "bus",
      "cab",
      "uber",
      "ola",
      "rapido",
      "taxi",
      "airport",
      "quiet",
      "remote work",
      "wifi",
      "work from"
    ]
  }
];
