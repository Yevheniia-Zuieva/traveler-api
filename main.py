from fastapi import FastAPI, Response, Request
from fastapi.responses import JSONResponse
from fastapi.exceptions import RequestValidationError
from pydantic import BaseModel, Field, model_validator, field_validator
from typing import List, Optional
from datetime import date, datetime
import asyncpg
import os
import uuid
import time
from dotenv import load_dotenv

load_dotenv()

app = FastAPI(title="Travel Planner API", version="1.0.0")

DB_DSN = os.getenv("DATABASE_URL")
pool = None

@app.on_event("startup")
async def startup():
    global pool
    # Встановлює SERIALIZABLE за замовчуванням для всіх з'єднань пулу
    async def init_connection(conn):
        await conn.execute("SET SESSION CHARACTERISTICS AS TRANSACTION ISOLATION LEVEL SERIALIZABLE;")

    pool = await asyncpg.create_pool(
        dsn=DB_DSN, 
        min_size=5, 
        max_size=20,
        init=init_connection
    )
    
@app.on_event("shutdown")
async def shutdown():
    await pool.close()

start_time = time.time()

@app.exception_handler(RequestValidationError)
async def validation_exception_handler(request: Request, exc: RequestValidationError):
    return JSONResponse(
        status_code=400,
        content={
            "error": "Validation error",
            "details": [f"{err['loc'][-1]}: {err['msg']}" for err in exc.errors()],
            "timestamp": datetime.utcnow().isoformat() + "Z"
        }
    )
    
# --- Моделі даних Pydantic ---
class TravelPlanBase(BaseModel):
    title: str = Field(..., min_length=1, max_length=200)
    description: Optional[str] = None
    start_date: Optional[date] = None
    end_date: Optional[date] = None
    budget: Optional[float] = Field(None, ge=0)
    currency: str = Field("USD", pattern="^[A-Z]{3}$")
    is_public: bool = False

    @field_validator('title')
    @classmethod
    def check_title_not_empty(cls, v):
        # Перехоплюємо рядки, які складаються лише з пробілів
        if v and not v.strip():
            raise ValueError("Title cannot be only whitespace")
        return v

    @field_validator('budget')
    @classmethod
    def check_budget_decimals(cls, v):
        # Якщо округлене до 2 знаків число не дорівнює оригіналу, отже, знаків було більше
        if v is not None and round(v, 2) != v:
            raise ValueError("Budget must have at most 2 decimal places")
        return v

    @model_validator(mode='after')
    def validate_dates(self):
        if self.end_date and not self.start_date:
            raise ValueError("Start date is required if end date is provided")
        if self.start_date and self.end_date and self.end_date < self.start_date:
            raise ValueError("End date must be >= start date")
        return self

class CreateTravelPlanRequest(TravelPlanBase):
    pass

class UpdateTravelPlanRequest(TravelPlanBase):
    version: int = Field(..., ge=1)

class LocationBase(BaseModel):
    name: str = Field(..., min_length=1, max_length=200)
    address: Optional[str] = None
    latitude: Optional[float] = Field(None, ge=-90, le=90)
    longitude: Optional[float] = Field(None, ge=-180, le=180)
    arrival_date: Optional[datetime] = None
    departure_date: Optional[datetime] = None
    budget: Optional[float] = Field(None, ge=0)
    notes: Optional[str] = None

    @field_validator('name')
    @classmethod
    def check_name_not_empty(cls, v):
        if v and not v.strip():
            raise ValueError("Name cannot be only whitespace")
        return v

    @field_validator('budget')
    @classmethod
    def check_budget_decimals(cls, v):
        if v is not None and round(v, 2) != v:
            raise ValueError("Budget must have at most 2 decimal places")
        return v

    @model_validator(mode='after')
    def validate_dates(self):
        if self.departure_date and not self.arrival_date:
            raise ValueError("Arrival date is required if departure date is provided")
        if self.arrival_date and self.departure_date and self.departure_date < self.arrival_date:
            raise ValueError("Departure date must be >= arrival date")
        return self

class CreateLocationRequest(LocationBase):
    parent_version: int = Field(..., ge=1) # Версія плану, яку бачить клієнт

class UpdateLocationRequest(LocationBase):
    parent_version: int = Field(..., ge=1) 

class TravelPlan(TravelPlanBase):
    id: uuid.UUID
    version: int
    created_at: datetime
    updated_at: datetime

class TravelPlanSummary(TravelPlan):
    location_count: int

class Location(LocationBase):
    id: uuid.UUID
    travel_plan_id: uuid.UUID
    visit_order: int
    created_at: datetime

class TravelPlanDetails(TravelPlan):
    locations: List[Location]

class DatabaseHealth(BaseModel):
    status: str
    responseTime: float
    
class HealthCheck(BaseModel):
    status: str
    timestamp: str
    uptime: Optional[float] = 0
    database: Optional[DatabaseHealth] = None

# --- Ендпоінти ---

@app.get(
    "/api/travel-plans", 
    response_model=List[TravelPlanSummary], 
    tags=["Travel Plans"],
    responses={500: {"description": "Internal server error"}}
)
async def list_travel_plans():
    query = """
        SELECT tp.*, 
               (SELECT COUNT(*) FROM locations l WHERE l.travel_plan_id = tp.id) as location_count
        FROM travel_plans tp
        ORDER BY tp.created_at DESC;
    """
    try:
        async with pool.acquire() as conn:
            plans = await conn.fetch(query)
        return [dict(plan) for plan in plans]
    except Exception:
        return JSONResponse(
            status_code=500,
            content={
                "error": "Internal server error",
                "timestamp": datetime.utcnow().isoformat() + "Z"
            }
        )

@app.post(
    "/api/travel-plans", 
    status_code=201, 
    response_model=TravelPlan, 
    tags=["Travel Plans"],
    responses={
        400: {"description": "Validation error"},
        500: {"description": "Internal server error"}
    }
)
async def create_travel_plan(plan: CreateTravelPlanRequest):
    # Перевірка валідності дат
    if plan.start_date and plan.end_date and plan.end_date < plan.start_date:
        return JSONResponse(
            status_code=400,
            content={
                "error": "Validation error",
                "details": ["End date must be after start date"],
                "timestamp": datetime.utcnow().isoformat() + "Z"
            }
        )

    query = """
        INSERT INTO travel_plans (title, description, start_date, end_date, budget, currency, is_public)
        VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *;
    """
    try:
        async with pool.acquire() as conn:
            row = await conn.fetchrow(
                query, plan.title, plan.description, plan.start_date, 
                plan.end_date, plan.budget, plan.currency, plan.is_public
            )
        return dict(row)
    except Exception:
        return JSONResponse(
            status_code=500,
            content={
                "error": "Internal server error",
                "timestamp": datetime.utcnow().isoformat() + "Z"
            }
        )

@app.get(
    "/api/travel-plans/{id}", 
    response_model=TravelPlanDetails, 
    tags=["Travel Plans"],
    responses={
        404: {"description": "Resource not found"},
        500: {"description": "Internal server error"}
    }
)
async def get_travel_plan(id: uuid.UUID):
    try:
        async with pool.acquire() as conn:
            plan = await conn.fetchrow("SELECT * FROM travel_plans WHERE id = $1", id)
            
            # Обробка помилки 404  
            if not plan:
                return JSONResponse(
                    status_code=404,
                    content={
                        "error": "Travel plan not found",
                        "timestamp": datetime.utcnow().isoformat() + "Z"
                    }
                )
                
            locations = await conn.fetch(
                "SELECT * FROM locations WHERE travel_plan_id = $1 ORDER BY visit_order ASC", 
                id
            )
            
        result = dict(plan)
        result['locations'] = [dict(loc) for loc in locations]
        return result
        
    except Exception:
        # Обробка 500 помилки
        return JSONResponse(
            status_code=500,
            content={
                "error": "Internal server error",
                "timestamp": datetime.utcnow().isoformat() + "Z"
            }
        )

@app.put(
    "/api/travel-plans/{id}", 
    response_model=TravelPlan, 
    tags=["Travel Plans"],
    responses={
        400: {"description": "Validation error"},
        404: {"description": "Resource not found"},
        409: {"description": "Optimistic locking conflict"},
        500: {"description": "Internal server error"}
    }
)
async def update_travel_plan(id: uuid.UUID, plan: UpdateTravelPlanRequest):
    # Валідація дат для 400 помилки
    if plan.start_date and plan.end_date and plan.end_date < plan.start_date:
        return JSONResponse(
            status_code=400,
            content={
                "error": "Validation error",
                "details": ["End date must be after start date"],
                "timestamp": datetime.utcnow().isoformat() + "Z"
            }
        )

    query = """
        UPDATE travel_plans 
        SET title=$1, description=$2, start_date=$3, end_date=$4, budget=$5, currency=$6, is_public=$7, version=version+1, updated_at=NOW()
        WHERE id=$8 AND version=$9 RETURNING *;
    """
    
    try:
        async with pool.acquire() as conn:
            row = await conn.fetchrow(
                query, plan.title, plan.description, plan.start_date, 
                plan.end_date, plan.budget, plan.currency, plan.is_public, 
                id, plan.version
            )
            
            if not row:
                # Перевіряємо, чи існує запис взагалі
                exists = await conn.fetchval("SELECT version FROM travel_plans WHERE id = $1", id)
                
                # Обробка 404 помилки
                if exists is None:
                    return JSONResponse(
                        status_code=404,
                        content={
                            "error": "Travel plan not found",
                            "timestamp": datetime.utcnow().isoformat() + "Z"
                        }
                    )
                
                # Обробка 409 помилки (версія не збіглася, конфлікт оптимістичного блокування)
                return JSONResponse(
                    status_code=409,
                    content={
                        "error": "Conflict: Travel plan was modified by another user",
                        "current_version": exists,
                        "message": "Please refresh and try again"
                    }
                )
                
        return dict(row)
        
    except Exception:
        # Обробка 500 помилки
        return JSONResponse(
            status_code=500,
            content={
                "error": "Internal server error",
                "timestamp": datetime.utcnow().isoformat() + "Z"
            }
        )

@app.delete(
    "/api/travel-plans/{id}", 
    status_code=204, 
    tags=["Travel Plans"],
    responses={
        204: {"description": "Travel plan deleted successfully"},
        404: {"description": "Resource not found"},
        500: {"description": "Internal server error"}
    }
)
async def delete_travel_plan(id: uuid.UUID, version: int): 
    try:
        async with pool.acquire() as conn:
            result = await conn.execute("DELETE FROM travel_plans WHERE id = $1 AND version = $2", id, version)
            
            if result == "DELETE 0":
                # Перевіряємо, чи план не знайдено, чи це конфлікт версій
                exists = await conn.fetchval("SELECT version FROM travel_plans WHERE id = $1", id)
                if exists is None:
                    return JSONResponse(status_code=404, content={"error": "Travel plan not found"})
                
                # Якщо план існує, але версія не збіглася — це 409 Conflict
                return JSONResponse(
                    status_code=409,
                    content={
                        "error": "Conflict: Travel plan was modified by another user",
                        "current_version": exists
                    }
                )
                
        return Response(status_code=204)
        
    except Exception:
        return JSONResponse(
            status_code=500,
            content={
                "error": "Internal server error",
                "timestamp": datetime.utcnow().isoformat() + "Z"
            }
        )
        
@app.post(
    "/api/travel-plans/{id}/locations", 
    status_code=201, 
    response_model=Location,
    tags=["Locations"],
    responses={
        201: {"description": "Location added successfully"},
        400: {"description": "Validation error"},
        404: {"description": "Resource not found"},
        500: {"description": "Internal server error"}
    }
)
async def add_location(id: uuid.UUID, loc: CreateLocationRequest):
    # Валідація дат для 400 помилки
    if loc.arrival_date and loc.departure_date and loc.departure_date < loc.arrival_date:
        return JSONResponse(
            status_code=400,
            content={
                "error": "Validation error",
                "details": ["Departure date must be >= arrival date"],
                "timestamp": datetime.utcnow().isoformat() + "Z"
            }
        )

    try:
        async with pool.acquire() as conn:
            async with conn.transaction():
                # Блокування батьківського плану подорожі для уникнення конфліктів
                plan = await conn.fetchrow(
                    "UPDATE travel_plans SET version=version+1, updated_at=NOW() WHERE id=$1 AND version=$2 RETURNING version", 
                    id, loc.parent_version
                )
                if not plan:
                    # Перевіряємо, чи план не знайдено, чи це конфлікт версій
                    current_v = await conn.fetchval("SELECT version FROM travel_plans WHERE id = $1", id)
                    
                    if current_v is None:
                        return JSONResponse(
                            status_code=404,
                            content={
                                "error": "Travel plan not found",
                                "timestamp": datetime.utcnow().isoformat() + "Z"
                            }
                        )
                    
                    # Якщо план існує, але версія не збіглася — це 409 Conflict
                    return JSONResponse(
                        status_code=409,
                        content={
                            "error": "Conflict: The travel plan was modified by another user",
                            "current_version": current_v
                        }
                    )
                
                # Отримуємо наступний visit_order для нової локації, дія безпечна від паралельних потоків
                next_order = await conn.fetchval(
                    "SELECT COALESCE(MAX(visit_order), 0) + 1 FROM locations WHERE travel_plan_id = $1", 
                    id
                )
                # Додаємо саму локацію з гарантовано унікальним порядком
                query = """
                    INSERT INTO locations (travel_plan_id, name, address, latitude, longitude, visit_order, arrival_date, departure_date, budget, notes)
                    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING *;
                """
                row = await conn.fetchrow(
                    query, id, loc.name, loc.address, loc.latitude, loc.longitude, 
                    next_order, loc.arrival_date, loc.departure_date, loc.budget, loc.notes
                )
        return dict(row)
        
    except Exception:
        return JSONResponse(
            status_code=500,
            content={
                "error": "Internal server error",
                "timestamp": datetime.utcnow().isoformat() + "Z"
            }
        )

@app.put(
    "/api/locations/{id}", 
    response_model=Location,
    tags=["Locations"],
    responses={
        200: {"description": "Location updated successfully"},
        400: {"description": "Validation error"},
        404: {"description": "Resource not found"},
        500: {"description": "Internal server error"}
    }
)
async def update_location(id: uuid.UUID, loc: UpdateLocationRequest):
    # Валідація дат для 400 помилки
    if loc.arrival_date and loc.departure_date and loc.departure_date < loc.arrival_date:
        return JSONResponse(
            status_code=400,
            content={
                "error": "Validation error",
                "details": ["Departure date must be >= arrival date"],
                "timestamp": datetime.utcnow().isoformat() + "Z"
            }
        )

    try:
        async with pool.acquire() as conn:
            async with conn.transaction():
                # Отримуємо travel_plan_id для батьківського плану цієї локації
                plan_id = await conn.fetchval("SELECT travel_plan_id FROM locations WHERE id = $1", id)
                if not plan_id:
                    return JSONResponse(
                        status_code=404,
                        content={
                            "error": "Location not found",
                            "timestamp": datetime.utcnow().isoformat() + "Z"
                        }
                    )

                # Перевіряємо parent_version при блокуванні
                plan = await conn.fetchrow(
                    "UPDATE travel_plans SET version = version + 1, updated_at = NOW() WHERE id = $1 AND version = $2 RETURNING version", 
                    plan_id, loc.parent_version
                )
                
                if not plan:
                    # Отримуємо реальну поточну версію для повідомлення
                    current_v = await conn.fetchval("SELECT version FROM travel_plans WHERE id = $1", plan_id)
                    return JSONResponse(
                        status_code=409,
                        content={
                            "error": "Conflict: The travel plan was modified by another user",
                            "current_version": current_v
                        }
                    )

                # Оновлюємо саму локацію в ізольованому середовищі
                query = """
                    UPDATE locations 
                    SET name=$1, address=$2, latitude=$3, longitude=$4, arrival_date=$5, departure_date=$6, budget=$7, notes=$8
                    WHERE id=$9 RETURNING *;
                """
                row = await conn.fetchrow(query, loc.name, loc.address, loc.latitude, loc.longitude, loc.arrival_date, loc.departure_date, loc.budget, loc.notes, id)
        return dict(row)
        
    except Exception:
        return JSONResponse(
            status_code=500,
            content={
                "error": "Internal server error",
                "timestamp": datetime.utcnow().isoformat() + "Z"
            }
        )

@app.delete(
    "/api/locations/{id}", 
    status_code=204, 
    tags=["Locations"],
    responses={
        204: {"description": "Location deleted successfully"},
        404: {"description": "Resource not found"},
        500: {"description": "Internal server error"}
    }
)
async def delete_location(id: uuid.UUID, parent_version: int):
    try:
        async with pool.acquire() as conn:
            async with conn.transaction():
                plan_id = await conn.fetchval("SELECT travel_plan_id FROM locations WHERE id = $1", id)
                if not plan_id:
                    return JSONResponse(
                        status_code=404,
                        content={
                            "error": "Location not found",
                            "timestamp": datetime.utcnow().isoformat() + "Z"
                        }
                    )

                # Блокуємо план із перевіркою версії
                plan = await conn.fetchrow(
                    "UPDATE travel_plans SET version = version + 1, updated_at = NOW() WHERE id = $1 AND version = $2 RETURNING version", 
                    plan_id, parent_version
                )
                
                if not plan:
                    current_v = await conn.fetchval("SELECT version FROM travel_plans WHERE id = $1", plan_id)
                    return JSONResponse(status_code=409, content={"error": "Conflict", "current_version": current_v})
                
                await conn.execute("DELETE FROM locations WHERE id = $1", id)
                
        return Response(status_code=204)
        
    except Exception:
        return JSONResponse(
            status_code=500,
            content={
                "error": "Internal server error",
                "timestamp": datetime.utcnow().isoformat() + "Z"
            }
        )

@app.get(
    "/health", 
    response_model=HealthCheck,
    tags=["System"],
    responses={
        200: {"description": "API is healthy"},
        503: {"description": "API is unhealthy"}
    }
)
async def health_check():
    uptime_ms = (time.time() - start_time) * 1000
    try:
        db_start = time.time()
        async with pool.acquire() as conn:
            await conn.execute("SELECT 1")
        db_response_time = (time.time() - db_start) * 1000
        
        return {
            "status": "healthy",
            "timestamp": datetime.utcnow().isoformat() + "Z",
            "uptime": round(uptime_ms, 2),
            "database": {
                "status": "healthy",
                "responseTime": round(db_response_time, 2)
            }
        }
    except Exception:
        return JSONResponse(
            status_code=503,
            content={
                "status": "unhealthy",
                "timestamp": datetime.utcnow().isoformat() + "Z",
                "uptime": round(uptime_ms, 2),
                "database": {
                    "status": "unhealthy",
                    "responseTime": 0
                }
            }
        )

@app.get("/api/check-isolation")
async def check_isolation():
    async with pool.acquire() as conn:
        isolation = await conn.fetchval("SHOW transaction_isolation;")
        return {"current_isolation_level": isolation}