-- Mongo gateway routing lets many Mongo databases share one public port
-- distinguished by SNI hostname, so port can no longer be globally unique.
DROP INDEX IF EXISTS "databases_port_key";

-- Keep port uniqueness for legacy direct/nginx-routed databases. Gateway
-- Mongo rows are excluded because they intentionally share MONGO_GATEWAY_PORT.
CREATE UNIQUE INDEX IF NOT EXISTS "databases_non_gateway_type_port_key"
ON "databases"("type", "port")
WHERE COALESCE("routing", 'direct') <> 'mongo-gateway';
