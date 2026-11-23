-- Events received from other suite services. The event id is the key, so a sender's retry is stored once.
CREATE TABLE received_events (
    id text PRIMARY KEY,
    type text NOT NULL,
    source text NOT NULL,
    occurred_at timestamptz NOT NULL,
    contract_version text NOT NULL,
    payload jsonb NOT NULL,
    received_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX received_events_type_received_at ON received_events (type, received_at);
