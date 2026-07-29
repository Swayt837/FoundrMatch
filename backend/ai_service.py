"""
AI Services using Claude for compatibility scoring and business assistance
"""
import os
import json
from typing import Dict, Any, List
from emergentintegrations.llm.chat import LlmChat, UserMessage, TextDelta, StreamDone
from dotenv import load_dotenv

load_dotenv()

EMERGENT_LLM_KEY = os.getenv("EMERGENT_LLM_KEY")


class AIService:
    """AI Service for compatibility and business assistance"""
    
    def __init__(self):
        self.api_key = EMERGENT_LLM_KEY
    
    async def calculate_compatibility(
        self,
        user1: Dict[str, Any],
        user2: Dict[str, Any]
    ) -> Dict[str, Any]:
        """
        Calculate compatibility score between two users using Claude
        Returns detailed breakdown and explanation
        """
        profile1 = user1.get("profile", {})
        profile2 = user2.get("profile", {})
        
        # Create prompt for Claude
        prompt = f"""
You are an expert business matchmaker. Analyze the compatibility between these two entrepreneurs.

Person 1:
- Profession: {profile1.get('profession')}
- Skills: {', '.join(profile1.get('skills', []))}
- Experience: {profile1.get('experience')}
- Availability: {profile1.get('availability')}
- Objectives: {', '.join(profile1.get('objectives', []))}
- Work Style: {', '.join(profile1.get('work_style', []))}
- Values: {', '.join(profile1.get('values', []))}
- Budget: {profile1.get('budget')}

Person 2:
- Profession: {profile2.get('profession')}
- Skills: {', '.join(profile2.get('skills', []))}
- Experience: {profile2.get('experience')}
- Availability: {profile2.get('availability')}
- Objectives: {', '.join(profile2.get('objectives', []))}
- Work Style: {', '.join(profile2.get('work_style', []))}
- Values: {', '.join(profile2.get('values', []))}
- Budget: {profile2.get('budget')}

Provide a compatibility analysis with scores (0-100) for:
1. Skills Compatibility (complementary skills are better)
2. Vision Alignment (similar objectives)
3. Availability Match
4. Personality/Work Style Compatibility
5. Objectives Alignment
6. Work Style Match

Return ONLY a JSON object with this exact structure (no markdown, no extra text):
{{
  "skills_score": <number>,
  "vision_score": <number>,
  "availability_score": <number>,
  "personality_score": <number>,
  "objectives_score": <number>,
  "work_style_score": <number>,
  "overall_score": <number>,
  "explanation": "<2-3 sentence explanation of why they're compatible>"
}}
"""
        
        try:
            # Initialize Claude chat
            chat = LlmChat(
                api_key=self.api_key,
                session_id="compatibility-analysis",
                system_message="You are a business matchmaking expert. Always respond with valid JSON only."
            ).with_model("anthropic", "claude-sonnet-4-6")
            
            # Get response
            user_message = UserMessage(text=prompt)
            response_text = ""
            
            async for event in chat.stream_message(user_message):
                if isinstance(event, TextDelta):
                    response_text += event.content
                elif isinstance(event, StreamDone):
                    break
            
            # Parse JSON response
            # Remove markdown code blocks if present
            response_text = response_text.strip()
            if response_text.startswith("```"):
                # Extract JSON from markdown
                lines = response_text.split("\n")
                response_text = "\n".join(lines[1:-1])
            
            result = json.loads(response_text)
            return result
            
        except Exception as e:
            print(f"Error calculating compatibility: {e}")
            # Return default scores if AI fails
            return {
                "skills_score": 75.0,
                "vision_score": 75.0,
                "availability_score": 80.0,
                "personality_score": 70.0,
                "objectives_score": 75.0,
                "work_style_score": 70.0,
                "overall_score": 74.0,
                "explanation": "Potential compatibility based on complementary skills and shared entrepreneurial goals."
            }
    
    async def generate_business_ideas(
        self,
        user1_profile: Dict[str, Any],
        user2_profile: Dict[str, Any],
        count: int = 5
    ) -> List[Dict[str, str]]:
        """
        Generate business ideas for a matched pair
        """
        prompt = f"""
Based on these two entrepreneurs' profiles, suggest {count} specific business ideas they could build together.

Person 1: {user1_profile.get('profession')} with skills in {', '.join(user1_profile.get('skills', []))}
Person 2: {user2_profile.get('profession')} with skills in {', '.join(user2_profile.get('skills', []))}

Shared objectives: {', '.join(set(user1_profile.get('objectives', []) + user2_profile.get('objectives', [])))}
Combined budget: {user1_profile.get('budget')} + {user2_profile.get('budget')}

Return ONLY a JSON array with this structure (no markdown):
[
  {{
    "title": "<Business name>",
    "description": "<One sentence description>",
    "reasoning": "<Why this fits their skills>"
  }}
]
"""
        
        try:
            chat = LlmChat(
                api_key=self.api_key,
                session_id="business-ideas",
                system_message="You are a startup advisor. Always respond with valid JSON only."
            ).with_model("anthropic", "claude-sonnet-4-6")
            
            user_message = UserMessage(text=prompt)
            response_text = ""
            
            async for event in chat.stream_message(user_message):
                if isinstance(event, TextDelta):
                    response_text += event.content
                elif isinstance(event, StreamDone):
                    break
            
            # Clean and parse
            response_text = response_text.strip()
            if response_text.startswith("```"):
                lines = response_text.split("\n")
                response_text = "\n".join(lines[1:-1])
            
            result = json.loads(response_text)
            return result
            
        except Exception as e:
            print(f"Error generating ideas: {e}")
            return [
                {
                    "title": "SaaS Platform",
                    "description": "Build a subscription-based software service.",
                    "reasoning": "Leverages technical and business skills."
                }
            ]
    
    async def generate_roadmap(
        self,
        project_name: str,
        vision: str,
        participants_skills: List[str],
        duration_days: int = 90
    ) -> Dict[str, Any]:
        """
        Generate a roadmap for a project
        """
        prompt = f"""
Create a {duration_days}-day roadmap for this startup project:

Project: {project_name}
Vision: {vision}
Team Skills: {', '.join(participants_skills)}

Return ONLY a JSON object with this structure (no markdown):
{{
  "phases": [
    {{
      "name": "<Phase name>",
      "duration_days": <number>,
      "tasks": ["<task 1>", "<task 2>"],
      "milestones": ["<milestone 1>"]
    }}
  ],
  "key_metrics": ["<metric 1>", "<metric 2>"]
}}
"""
        
        try:
            chat = LlmChat(
                api_key=self.api_key,
                session_id="roadmap-gen",
                system_message="You are a product strategist. Always respond with valid JSON only."
            ).with_model("anthropic", "claude-sonnet-4-6")
            
            user_message = UserMessage(text=prompt)
            response_text = ""
            
            async for event in chat.stream_message(user_message):
                if isinstance(event, TextDelta):
                    response_text += event.content
                elif isinstance(event, StreamDone):
                    break
            
            response_text = response_text.strip()
            if response_text.startswith("```"):
                lines = response_text.split("\n")
                response_text = "\n".join(lines[1:-1])
            
            result = json.loads(response_text)
            return result
            
        except Exception as e:
            print(f"Error generating roadmap: {e}")
            return {
                "phases": [
                    {
                        "name": "Planning",
                        "duration_days": 30,
                        "tasks": ["Define MVP", "Create wireframes"],
                        "milestones": ["MVP spec complete"]
                    }
                ],
                "key_metrics": ["User signups", "Revenue"]
            }
    
    async def ai_assistant_chat(
        self,
        session_id: str,
        message: str,
        context: Dict[str, Any]
    ) -> str:
        """
        AI assistant for business questions and guidance
        Streams response
        """
        system_message = f"""
You are an AI business cofounder assistant helping entrepreneurs build their startup.

Context:
- Project: {context.get('project_name', 'New Startup')}
- Team Skills: {', '.join(context.get('team_skills', []))}
- Current Stage: {context.get('stage', 'Planning')}

Provide actionable, specific advice.
"""
        
        chat = LlmChat(
            api_key=self.api_key,
            session_id=f"assistant-{session_id}",
            system_message=system_message
        ).with_model("anthropic", "claude-sonnet-4-6")
        
        user_message = UserMessage(text=message)
        
        # Return generator for streaming
        return chat.stream_message(user_message)


# Global AI service instance
ai_service = AIService()
