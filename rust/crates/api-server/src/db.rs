use sqlx::{sqlite::SqlitePoolOptions, SqlitePool};

pub async fn init_db() -> Result<SqlitePool, sqlx::Error> {
    use sqlx::sqlite::SqliteConnectOptions;

    let options = SqliteConnectOptions::new()
        .filename("claw_agent.db")
        .create_if_missing(true);

    let pool = SqlitePoolOptions::new()
        .max_connections(5)
        .connect_with(options)
        .await?;

    ensure_schema(&pool).await?;

    Ok(pool)
}

pub async fn ensure_schema(pool: &SqlitePool) -> Result<(), sqlx::Error> {
    sqlx::query(
        r#"
        CREATE TABLE IF NOT EXISTS users (
            id TEXT PRIMARY KEY,
            email TEXT NOT NULL UNIQUE,
            full_name TEXT NOT NULL,
            password_hash TEXT NOT NULL,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        );

        CREATE TABLE IF NOT EXISTS sessions (
            id TEXT PRIMARY KEY,
            user_id TEXT NOT NULL,
            title TEXT,
            state JSON NOT NULL,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (user_id) REFERENCES users(id)
        );

        CREATE TABLE IF NOT EXISTS user_configs (
            user_id TEXT PRIMARY KEY,
            qwen_api_key TEXT,
            openai_api_key TEXT,
            preferences JSON,
            FOREIGN KEY (user_id) REFERENCES users(id)
        );
        "#,
    )
    .execute(pool)
    .await?;

    Ok(())
}
