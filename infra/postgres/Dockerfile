# Postgres with the two extensions the schema needs: PostGIS (places near a locality) and pgvector (claim search).
# The official PostGIS image already carries the PostgreSQL apt repository, which ships pgvector builds.
FROM postgis/postgis:17-3.6

RUN apt-get update \
  && apt-get install -y --no-install-recommends postgresql-17-pgvector \
  && rm -rf /var/lib/apt/lists/*
