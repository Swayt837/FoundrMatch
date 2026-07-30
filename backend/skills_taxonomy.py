"""
Skill taxonomy: free-text skills → canonical concepts → domains.

Why this exists: comparing skills as raw strings makes "React", "React.js" and
"Frontend" three unrelated skills, so a frontend developer and a React developer
looked perfectly complementary. Embeddings would solve it, but they would mean a
new vendor and a per-profile API cost. A curated taxonomy gets most of the value
deterministically, for free, and is testable.

Two levels are used by the scorer:

- **concept** — the deduplicated skill ("react", "figma"). Overlap at this level
  means the two founders know the same thing.
- **domain** — the area of work ("frontend", "design"). Different domains are what
  makes a pair complementary; that is the signal cofounder matching cares about.

Unknown skills are not discarded: they keep their normalised form as their own
concept, so a niche skill still matches an identical niche skill.
"""
import re
from typing import Dict, List, Set, Tuple

# Domains, ordered from most technical to most commercial. Used for
# complementarity: the further apart two founders' domains, the better.
DOMAINS = (
    "frontend",
    "backend",
    "mobile",
    "data",
    "infrastructure",
    "design",
    "product",
    "growth",
    "sales",
    "finance",
    "legal",
    "operations",
    "content",
)

# canonical concept -> (domain, aliases)
# Aliases are matched after normalisation, so casing, punctuation and spacing
# don't matter — only add spellings that normalise differently.
_TAXONOMY: Dict[str, Tuple[str, Tuple[str, ...]]] = {
    # --- frontend ---
    "react": ("frontend", ("reactjs", "react js", "react native web")),
    "vue": ("frontend", ("vuejs", "vue js", "nuxt")),
    "angular": ("frontend", ("angularjs",)),
    "svelte": ("frontend", ("sveltekit",)),
    "nextjs": ("frontend", ("next", "next js")),
    "typescript": ("frontend", ("ts",)),
    "javascript": ("frontend", ("js", "es6", "ecmascript")),
    "html_css": ("frontend", ("html", "css", "htmlcss", "html5", "css3", "tailwind", "sass", "scss")),
    "frontend": ("frontend", ("front end", "frontend dev", "frontend development", "web frontend", "ui development")),

    # --- backend ---
    "python": ("backend", ("py", "django", "flask", "fastapi")),
    "nodejs": ("backend", ("node", "node js", "express", "expressjs", "nestjs")),
    "ruby": ("backend", ("rails", "ruby on rails", "ror")),
    "java": ("backend", ("spring", "spring boot", "springboot")),
    "golang": ("backend", ("go",)),
    "rust": ("backend", ()),
    "php": ("backend", ("laravel", "symfony")),
    "dotnet": ("backend", ("c#", "csharp", "asp net", "aspnet")),
    "api_design": ("backend", ("api", "apis", "rest", "restful", "graphql", "grpc", "api development")),
    "backend": ("backend", ("back end", "backend dev", "backend development", "server side")),

    # --- mobile ---
    "ios": ("mobile", ("swift", "swiftui", "objective c", "objectivec")),
    "android": ("mobile", ("kotlin",)),
    "react_native": ("mobile", ("reactnative", "react native", "expo")),
    "flutter": ("mobile", ("dart",)),
    "mobile": ("mobile", ("mobile dev", "mobile development", "app development")),

    # --- data / AI ---
    "machine_learning": ("data", ("ml", "ai", "artificial intelligence", "deep learning", "llm", "llms", "genai", "nlp", "pytorch", "tensorflow", "ai ml")),
    "data_engineering": ("data", ("etl", "data pipelines", "spark", "airflow", "data engineering")),
    "data_analysis": ("data", ("analytics", "data analysis", "data analytics", "sql", "bi", "business intelligence", "tableau", "looker")),
    "data_science": ("data", ("datascience", "data science", "statistics", "r")),

    # --- infrastructure ---
    "devops": ("infrastructure", ("ci cd", "cicd", "ci", "cd", "sre", "platform engineering")),
    "cloud": ("infrastructure", ("aws", "gcp", "azure", "cloud infrastructure", "serverless")),
    "containers": ("infrastructure", ("docker", "kubernetes", "k8s")),
    "databases": ("infrastructure", ("postgres", "postgresql", "mysql", "mongodb", "mongo", "redis", "database", "db")),
    "security": ("infrastructure", ("cybersecurity", "infosec", "appsec", "pentesting")),
    "system_design": ("infrastructure", ("systems design", "architecture", "software architecture", "scalability", "distributed systems")),

    # --- design ---
    "ui_design": ("design", ("ui", "ui ux", "uiux", "ux ui", "interface design")),
    "ux_research": ("design", ("ux", "user research", "ux research", "usability")),
    "figma": ("design", ("sketch", "adobe xd", "xd")),
    "branding": ("design", ("brand", "brand identity", "visual identity", "logo design")),
    "graphic_design": ("design", ("graphics", "illustration", "photoshop", "illustrator")),
    "motion_design": ("design", ("animation", "after effects", "motion graphics")),
    "design_systems": ("design", ("design system", "component library")),

    # --- product ---
    "product_management": ("product", ("pm", "product", "product owner", "po", "roadmapping", "product strategy")),
    "user_testing": ("product", ("ab testing", "a b testing", "experimentation", "product discovery")),
    "project_management": ("product", ("agile", "scrum", "kanban", "delivery")),

    # --- growth / marketing ---
    "seo": ("growth", ("search engine optimization", "sem", "organic search")),
    "paid_ads": ("growth", ("google ads", "meta ads", "facebook ads", "tiktok ads", "ppc", "paid acquisition", "performance marketing", "paid media")),
    "growth_marketing": ("growth", ("growth", "growth hacking", "acquisition", "user acquisition", "demand generation")),
    "email_marketing": ("growth", ("crm marketing", "newsletter", "lifecycle marketing")),
    "social_media": ("growth", ("community management", "community", "social")),
    "analytics_marketing": ("growth", ("google analytics", "ga4", "attribution", "marketing analytics")),
    "marketing": ("growth", ("digital marketing", "online marketing")),

    # --- sales ---
    "b2b_sales": ("sales", ("b2b", "enterprise sales", "enterprise deals", "saas sales", "outbound", "cold outreach", "prospecting")),
    "account_management": ("sales", ("customer success", "cs", "account management", "partnerships", "bizdev", "business development")),
    "negotiation": ("sales", ("closing", "deal making")),
    "sales": ("sales", ("selling", "sales management")),

    # --- finance ---
    "fundraising": ("finance", ("vc", "venture capital", "raising", "pitch deck", "investor relations", "seed", "series a")),
    "accounting": ("finance", ("bookkeeping", "controlling")),
    "financial_modeling": ("finance", ("modeling", "modelling", "financial planning", "fp a", "forecasting", "unit economics")),
    "finance": ("finance", ("corporate finance", "cfo")),

    # --- legal ---
    "corporate_law": ("legal", ("company law", "incorporation", "cap table", "shareholder agreements")),
    "ip_law": ("legal", ("intellectual property", "patents", "trademarks")),
    "compliance": ("legal", ("gdpr", "privacy", "regulatory", "data protection")),
    "contracts": ("legal", ("contract law", "legal drafting")),

    # --- operations ---
    "operations": ("operations", ("ops", "business operations", "biz ops", "bizops")),
    "supply_chain": ("operations", ("logistics", "procurement", "inventory")),
    "hiring": ("operations", ("recruiting", "recruitment", "talent", "people ops", "hr")),
    "customer_support": ("operations", ("support", "helpdesk")),

    # --- content ---
    "copywriting": ("content", ("copy", "writing", "content writing", "editing")),
    "content_strategy": ("content", ("content", "content marketing", "editorial")),
    "video": ("content", ("video editing", "videography", "youtube", "video production")),
    "photography": ("content", ("photo", "photo editing")),
    "podcasting": ("content", ("podcast", "audio")),
}

# The profession field is a strong domain signal on its own — a profile with no
# recognised skills still lands in a domain.
PROFESSION_DOMAIN: Dict[str, str] = {
    "developer": "backend",
    "designer": "design",
    "marketer": "growth",
    "sales": "sales",
    "product_manager": "product",
    "lawyer": "legal",
    "finance": "finance",
    "content_creator": "content",
    "freelancer": "operations",
    "student": "product",
}

# alias -> canonical concept, built once at import
_ALIAS_TO_CONCEPT: Dict[str, str] = {}
_CONCEPT_DOMAIN: Dict[str, str] = {}

for _concept, (_domain, _aliases) in _TAXONOMY.items():
    _CONCEPT_DOMAIN[_concept] = _domain
    _ALIAS_TO_CONCEPT[_concept.replace("_", " ")] = _concept
    _ALIAS_TO_CONCEPT[_concept] = _concept
    for _alias in _aliases:
        _ALIAS_TO_CONCEPT[_alias] = _concept

_NON_ALNUM = re.compile(r"[^a-z0-9+#]+")


def normalize(skill: str) -> str:
    """
    Reduce a free-text skill to a comparable key.

    Lower-cases, strips punctuation and collapses whitespace, so "UI/UX",
    "ui ux" and "Ui-Ux" all become "ui ux". `+` and `#` survive so "c#" and
    "c++" stay distinguishable.
    """
    cleaned = _NON_ALNUM.sub(" ", (skill or "").lower()).strip()
    return re.sub(r"\s+", " ", cleaned)


def canonicalize(skill: str) -> Tuple[str, bool]:
    """
    Map one skill to its canonical concept.

    Returns `(concept, known)`. For an unrecognised skill the normalised form is
    returned with `known=False` — it still compares equal to an identical skill on
    another profile, it just carries no domain.
    """
    key = normalize(skill)
    if not key:
        return "", False

    concept = _ALIAS_TO_CONCEPT.get(key)
    if concept:
        return concept, True

    # "senior react developer" → react. Longest alias wins so "react native"
    # is not shadowed by "react".
    words = key.split()
    for alias in sorted(_ALIAS_TO_CONCEPT, key=len, reverse=True):
        if " " in alias:
            if alias in key:
                return _ALIAS_TO_CONCEPT[alias], True
        elif alias in words:
            return _ALIAS_TO_CONCEPT[alias], True

    return key, False


def concepts_for(skills: List[str]) -> Set[str]:
    """Canonical concepts covered by a list of free-text skills."""
    found = set()
    for skill in skills or []:
        concept, _known = canonicalize(skill)
        if concept:
            found.add(concept)
    return found


def domains_for(skills: List[str], profession: str = "") -> Set[str]:
    """
    Domains a founder works in, from their skills plus their stated profession.

    The profession is included so a profile with only unrecognised skills is not
    treated as domain-less.
    """
    domains = set()
    for skill in skills or []:
        concept, known = canonicalize(skill)
        if known:
            domains.add(_CONCEPT_DOMAIN[concept])

    profession_domain = PROFESSION_DOMAIN.get(normalize(profession).replace(" ", "_"))
    if profession_domain:
        domains.add(profession_domain)

    return domains


def unknown_skills(skills: List[str]) -> List[str]:
    """
    Skills the taxonomy doesn't recognise.

    Exposed so the gaps can be reviewed and folded back into `_TAXONOMY` — the
    taxonomy only stays useful if it tracks what users actually type.
    """
    return [s for s in skills or [] if s and not canonicalize(s)[1]]
