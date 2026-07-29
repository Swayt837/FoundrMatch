"""
Database models for CoFound application
"""
from pydantic import BaseModel, EmailStr, Field
from typing import Optional, List, Dict, Any
from datetime import datetime
from enum import Enum


# Enums for structured data
class Profession(str, Enum):
    DEVELOPER = "developer"
    DESIGNER = "designer"
    MARKETER = "marketer"
    SALES = "sales"
    PRODUCT_MANAGER = "product_manager"
    LAWYER = "lawyer"
    FINANCE = "finance"
    CONTENT_CREATOR = "content_creator"
    FREELANCER = "freelancer"
    STUDENT = "student"


class ExperienceLevel(str, Enum):
    BEGINNER = "beginner"
    JUNIOR = "junior"
    CONFIRMED = "confirmed"
    SENIOR = "senior"
    SOLD_COMPANY = "sold_company"
    RAISED_FUNDS = "raised_funds"
    MULTIPLE_STARTUPS = "multiple_startups"


class Availability(str, Enum):
    FULL_TIME = "full_time"
    TEN_HOURS = "10h_week"
    TWENTY_HOURS = "20h_week"
    EVENINGS = "evenings"
    WEEKENDS = "weekends"
    IMMEDIATE = "immediate"


class WorkStyle(str, Enum):
    REMOTE = "remote"
    IN_PERSON = "in_person"
    HYBRID = "hybrid"
    FAST_PACED = "fast_paced"
    METHODICAL = "methodical"
    EVENING_WORK = "evening_work"
    EARLY_WORK = "early_work"


class ValueType(str, Enum):
    BOOTSTRAP = "bootstrap"
    RAISE_FUNDS = "raise_funds"
    NOMAD = "nomad"
    FAMILY = "family"
    FAST_GROWTH = "fast_growth"
    PROFITABILITY = "profitability"
    IMPACT = "impact"


# User Profile Models
class ProfileInfo(BaseModel):
    name: str
    photos: List[str] = []  # base64 encoded images
    country: str
    city: str
    languages: List[str]
    age: Optional[int] = None
    bio: Optional[str] = None
    profession: Profession
    skills: List[str]
    experience: ExperienceLevel
    availability: Availability
    budget: str
    objectives: List[str]
    personality: Optional[Dict[str, Any]] = None
    work_style: List[WorkStyle]
    values: List[ValueType]


class Verification(BaseModel):
    email_verified: bool = False
    linkedin_verified: bool = False
    github_verified: bool = False
    portfolio_verified: bool = False
    identity_verified: bool = False


class Gamification(BaseModel):
    level: int = 1
    projects_count: int = 0
    startups_created: int = 0
    recommendations_count: int = 0
    badges: List[str] = []


class Location(BaseModel):
    latitude: float
    longitude: float


class UserSettings(BaseModel):
    notifications_enabled: bool = True
    distance_preference: int = 100  # in km
    show_age: bool = True
    premium: bool = False


# API Request/Response Models
class UserRegistration(BaseModel):
    email: EmailStr
    password: str
    name: str


class UserLogin(BaseModel):
    email: EmailStr
    password: str


class OnboardingData(BaseModel):
    country: str
    city: str
    languages: List[str]
    age: Optional[int] = None
    profession: Profession
    skills: List[str]
    experience: ExperienceLevel
    availability: Availability
    budget: str
    objectives: List[str]
    work_style: List[WorkStyle]
    values: List[ValueType]
    bio: Optional[str] = None


class SwipeAction(BaseModel):
    target_user_id: str
    direction: str  # "left" or "right"


class MessageCreate(BaseModel):
    match_id: str
    content: str
    type: str = "text"


class CompatibilityScore(BaseModel):
    skills_score: float
    vision_score: float
    availability_score: float
    personality_score: float
    objectives_score: float
    work_style_score: float
    overall_score: float
    explanation: str


class MatchResponse(BaseModel):
    match_id: str
    user: Dict[str, Any]
    compatibility: CompatibilityScore
    created_at: datetime


class ProjectCreate(BaseModel):
    title: str
    description: str
    looking_for: Profession
    hours_per_week: int
    equity_percentage: float
    skills_needed: List[str]


class DealRoomCreate(BaseModel):
    match_id: str
    project_name: str
    vision: str


class DealRoomTask(BaseModel):
    title: str
    description: str
    assigned_to: str
    due_date: Optional[datetime] = None
    completed: bool = False


class AIBusinessRequest(BaseModel):
    match_id: str
    prompt: str
    context: Optional[Dict[str, Any]] = None
