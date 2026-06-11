-- Live FX rates cache (shared across all orgs — rates are universal)
CREATE TABLE IF NOT EXISTS fx_rates (
  base        varchar(8)  NOT NULL,
  quote       varchar(8)  NOT NULL,
  rate        real        NOT NULL,
  updated_at  timestamp   NOT NULL DEFAULT now(),
  PRIMARY KEY (base, quote)
);
