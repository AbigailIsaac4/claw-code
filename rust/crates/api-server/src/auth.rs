use axum::{
    async_trait,
    extract::{FromRequestParts, State},
    http::{request::Parts, StatusCode},
    Json,
};
use bcrypt::{hash, verify, DEFAULT_COST};
use jsonwebtoken::{decode, encode, DecodingKey, EncodingKey, Header, Validation};
use serde::{Deserialize, Serialize};
use sqlx::Row;
use uuid::Uuid;

use crate::state::AppState;

const JWT_SECRET: &[u8] = b"claw_agent_super_secret_key_change_in_prod";

#[derive(Debug, Serialize, Deserialize)]
pub struct Claims {
    pub sub: String, // user_id
    pub exp: usize,
}

#[derive(Deserialize)]
pub struct AuthPayload {
    pub email: String,
    pub password: String,
    pub full_name: Option<String>, // 注册时必填，登录时可为空
}

#[derive(Serialize)]
pub struct AuthResponse {
    pub token: String,
    pub user_id: String,
    pub email: String,
    pub full_name: String,
}

pub async fn register(
    State(state): State<AppState>,
    Json(payload): Json<AuthPayload>,
) -> Result<Json<AuthResponse>, (StatusCode, String)> {
    if payload.email.is_empty() || payload.password.is_empty() {
        return Err((StatusCode::BAD_REQUEST, "邮箱或密码不能为空".into()));
    }

    let full_name = payload.full_name.unwrap_or_else(|| "User".to_string());

    let password_hash = hash(&payload.password, DEFAULT_COST)
        .map_err(|_| (StatusCode::INTERNAL_SERVER_ERROR, "加密失败".into()))?;

    let user_id = Uuid::new_v4().to_string();

    let result =
        sqlx::query("INSERT INTO users (id, email, full_name, password_hash) VALUES (?, ?, ?, ?)")
            .bind(&user_id)
            .bind(&payload.email)
            .bind(&full_name)
            .bind(&password_hash)
            .execute(&state.db)
            .await;

    if result.is_err() {
        return Err((StatusCode::BAD_REQUEST, "该邮箱已被注册".into()));
    }

    let token = create_jwt(&user_id)?;

    Ok(Json(AuthResponse {
        token,
        user_id,
        email: payload.email,
        full_name,
    }))
}

pub async fn login(
    State(state): State<AppState>,
    Json(payload): Json<AuthPayload>,
) -> Result<Json<AuthResponse>, (StatusCode, String)> {
    let row = sqlx::query("SELECT id, full_name, password_hash FROM users WHERE email = ?")
        .bind(&payload.email)
        .fetch_optional(&state.db)
        .await
        .map_err(|_| (StatusCode::INTERNAL_SERVER_ERROR, "数据库访问失败".into()))?;

    if let Some(record) = row {
        let user_id: String = record.get("id");
        let hash: String = record.get("password_hash");
        let full_name: String = record.get("full_name");

        let is_valid = verify(&payload.password, &hash).unwrap_or(false);
        if is_valid {
            let token = create_jwt(&user_id)?;
            return Ok(Json(AuthResponse {
                token,
                user_id,
                email: payload.email,
                full_name,
            }));
        }
    }

    Err((StatusCode::UNAUTHORIZED, "邮箱或密码错误".into()))
}

fn create_jwt(user_id: &str) -> Result<String, (StatusCode, String)> {
    let expiration = (chrono::Utc::now().timestamp() + 7 * 24 * 3600) as usize; // 7天过期

    let claims = Claims {
        sub: user_id.to_owned(),
        exp: expiration,
    };

    encode(
        &Header::default(),
        &claims,
        &EncodingKey::from_secret(JWT_SECRET),
    )
    .map_err(|_| (StatusCode::INTERNAL_SERVER_ERROR, "令牌生成失败".into()))
}

// 用于受保护路由的 JWT 验证 Extractor
pub struct AuthUser {
    pub user_id: String,
}

#[async_trait]
impl<S> FromRequestParts<S> for AuthUser
where
    S: Send + Sync,
{
    type Rejection = (StatusCode, &'static str);

    async fn from_request_parts(parts: &mut Parts, _state: &S) -> Result<Self, Self::Rejection> {
        let auth_header = parts
            .headers
            .get("Authorization")
            .and_then(|h| h.to_str().ok())
            .and_then(|h| h.strip_prefix("Bearer "));

        let token = auth_header.ok_or((StatusCode::UNAUTHORIZED, "请先登录"))?;

        let token_data = decode::<Claims>(
            token,
            &DecodingKey::from_secret(JWT_SECRET),
            &Validation::default(),
        )
        .map_err(|_| (StatusCode::UNAUTHORIZED, "登录状态已过期或无效"))?;

        Ok(AuthUser {
            user_id: token_data.claims.sub,
        })
    }
}
