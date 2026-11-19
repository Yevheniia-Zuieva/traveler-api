CREATE EXTENSION IF NOT EXISTS "pgcrypto";

CREATE TABLE travel_plans (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    title VARCHAR(200) NOT NULL CHECK (length(title) > 0),
    description TEXT,
    start_date DATE,
    end_date DATE CHECK (end_date >= start_date),
    budget DECIMAL(10,2) CHECK (budget >= 0),
    currency VARCHAR(3) DEFAULT 'USD' CHECK (length(currency) = 3),
    is_public BOOLEAN DEFAULT FALSE,
    version INTEGER DEFAULT 1 CHECK (version > 0),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE locations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    travel_plan_id UUID NOT NULL REFERENCES travel_plans(id) ON DELETE CASCADE,
    name VARCHAR(200) NOT NULL CHECK (length(name) > 0),
    address TEXT,
    latitude DECIMAL(10,6) CHECK (latitude BETWEEN -90 AND 90),
    longitude DECIMAL(10,6) CHECK (longitude BETWEEN -180 AND 180),
    visit_order INTEGER NOT NULL CHECK (visit_order > 0),
    arrival_date TIMESTAMPTZ,
    departure_date TIMESTAMPTZ CHECK (departure_date >= arrival_date),
    budget DECIMAL(10,2) CHECK (budget >= 0),
    notes TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);