"""
Database models for CoFound application
"""
from pydantic import BaseModel, EmailStr, Field, field_validator
from typing import Literal, Optional, List, Dict, Any
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
    # `premium` deliberately lives at the user document root, not here — see
    # premium.py. A second copy under settings only ever drifted out of sync.


# API Request/Response Models
class UserRegistration(BaseModel):
    email: EmailStr
    password: str = Field(min_length=8, max_length=128)
    name: str = Field(min_length=1, max_length=100)


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


class PhotosUpload(BaseModel):
    """
    Profile photo upload payload.

    Wrapped in a model so FastAPI reads it from the request body — a bare
    `List[str]` parameter is parsed as a repeated query parameter. Photos are
    base64 strings stored inline in the user document, so the total size is capped
    well below MongoDB's 16 MB document limit.
    """
    photos: List[str] = Field(default_factory=list, max_length=5)

    @field_validator("photos")
    @classmethod
    def check_photo_sizes(cls, photos: List[str]) -> List[str]:
        max_photo_chars = 3_000_000  # ~2.2 MB decoded
        max_total_chars = 10_000_000  # ~7.5 MB decoded, leaves room in the doc

        for photo in photos:
            if len(photo) > max_photo_chars:
                raise ValueError("Each photo must be under ~2MB")
        if sum(len(p) for p in photos) > max_total_chars:
            raise ValueError("Photos are too large in total; please use smaller images")
        return photos


class PersonalityAnswers(BaseModel):
    """
    Personality assessment submission: `{question_id: 1..5}`.

    Values are validated against the live question set in `personality.py` rather
    than here, so adding a question does not mean editing two files.
    """
    answers: Dict[str, Any] = Field(default_factory=dict)


class SwipeAction(BaseModel):
    target_user_id: str
    direction: Literal["left", "right"]


class MessageCreate(BaseModel):
    match_id: str
    content: str = Field(min_length=1, max_length=4000)
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
    title: str = Field(min_length=1, max_length=200)
    description: str = Field(min_length=1, max_length=5000)
    looking_for: Profession
    hours_per_week: int = Field(ge=1, le=80)
    equity_percentage: float = Field(ge=0, le=100)
    skills_needed: List[str] = Field(default_factory=list, max_length=20)


class ProjectApplication(BaseModel):
    """Message a founder sends when applying to a cofounder opportunity."""
    message: str = Field(default="", max_length=2000)


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
