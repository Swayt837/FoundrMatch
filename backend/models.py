"""
Database models for CoFoundr application
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
    Profile photo list.

    Wrapped in a model so FastAPI reads it from the request body — a bare
    `List[str]` parameter is parsed as a repeated query parameter.

    Each entry is either a URL in our own object storage (the normal path, see
    storage.py) or an inline `data:` URI. Inline images are still accepted so the
    app works against a deployment with no storage configured, and so profiles
    written before the migration keep validating, but they are capped well below
    MongoDB's 16 MB document limit.

    Anything else is refused. Accepting arbitrary URLs would let a client store
    a third-party address in their profile and turn everyone who views it into a
    request to that server, handing over their IP address.
    """
    photos: List[str] = Field(default_factory=list, max_length=5)

    @field_validator("photos")
    @classmethod
    def check_photos(cls, photos: List[str]) -> List[str]:
        import storage

        max_photo_chars = 3_000_000  # ~2.2 MB decoded
        max_total_chars = 10_000_000  # ~7.5 MB decoded, leaves room in the doc

        inline_total = 0
        for photo in photos:
            if storage.is_managed_url(photo):
                continue
            if not photo.startswith("data:"):
                raise ValueError(
                    "Photos must be uploaded through /api/uploads/photo; "
                    "external URLs are not accepted"
                )
            if len(photo) > max_photo_chars:
                raise ValueError("Each photo must be under ~2MB")
            inline_total += len(photo)

        if inline_total > max_total_chars:
            raise ValueError("Photos are too large in total; please use smaller images")
        return photos


class ShowcaseItem(BaseModel):
    """
    One thing a founder has built.

    Separate from `photos`, which are pictures of the person. The two answer
    different questions — "who am I dealing with" and "what have they actually
    shipped" — and merging them is how a swipe card ends up leading with a
    revenue chart instead of a face.

    `kind` is derived from the URL rather than trusted from the client, so a
    video cannot be declared an image to skip the thumbnail requirement.
    """
    url: str = Field(min_length=1, max_length=2000)
    caption: str = Field(default="", max_length=140)
    # Videos need a still to render in a grid; without one every tile would have
    # to download a video file just to show something.
    thumbnail_url: Optional[str] = Field(default=None, max_length=2000)
    duration_seconds: Optional[float] = Field(default=None, ge=0, le=600)

    @property
    def kind(self) -> str:
        return "video" if _looks_like_video(self.url) else "image"


VIDEO_EXTENSIONS = (".mp4", ".mov")


def _looks_like_video(url: str) -> bool:
    return url.lower().split("?")[0].endswith(VIDEO_EXTENSIONS)


class ShowcaseUpdate(BaseModel):
    """The full showcase list, replacing whatever was there."""
    items: List[ShowcaseItem] = Field(default_factory=list, max_length=8)

    @field_validator("items")
    @classmethod
    def check_items(cls, items: List[ShowcaseItem]) -> List[ShowcaseItem]:
        import storage

        for item in items:
            # Same rule as profile photos: only URLs this deployment produced.
            # An arbitrary URL in a profile turns every viewer into a request to
            # someone else's server, carrying their IP address.
            if not storage.is_managed_url(item.url):
                raise ValueError(
                    "Showcase items must be uploaded through /api/uploads/showcase"
                )
            if item.thumbnail_url and not storage.is_managed_url(item.thumbnail_url):
                raise ValueError("Thumbnails must be uploaded the same way")

            if _looks_like_video(item.url):
                if not item.thumbnail_url:
                    raise ValueError("A video needs a thumbnail")
                if (
                    item.duration_seconds is not None
                    and item.duration_seconds > storage.MAX_SHOWCASE_VIDEO_SECONDS
                ):
                    raise ValueError(
                        f"Videos must be under {storage.MAX_SHOWCASE_VIDEO_SECONDS} seconds"
                    )
        return items


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
