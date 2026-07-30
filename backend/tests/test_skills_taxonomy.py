"""
Skill taxonomy tests.

The taxonomy is what lets the scorer tell "React" and "Frontend" apart from
"React" and "Figma". No dependencies — runs anywhere.

Run with: pytest backend/tests -o addopts=''
"""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from skills_taxonomy import (  # noqa: E402
    DOMAINS,
    PROFESSION_DOMAIN,
    canonicalize,
    concepts_for,
    domains_for,
    normalize,
    unknown_skills,
)


class TestNormalize:
    def test_lowercases_and_trims(self):
        assert normalize("  React  ") == "react"

    def test_collapses_punctuation_to_spaces(self):
        assert normalize("UI/UX") == "ui ux"
        assert normalize("Ui-Ux") == "ui ux"
        assert normalize("UI  UX") == "ui ux"

    def test_keeps_language_defining_characters(self):
        # "c#" and "c++" must stay distinguishable from "c"
        assert normalize("C#") == "c#"
        assert normalize("C++") == "c++"

    def test_empty_and_none_safe(self):
        assert normalize("") == ""
        assert normalize(None) == ""


class TestCanonicalize:
    def test_exact_alias(self):
        assert canonicalize("React") == ("react", True)

    def test_alias_variants_collapse(self):
        assert canonicalize("ReactJS")[0] == "react"
        assert canonicalize("react js")[0] == "react"

    def test_framework_maps_to_its_language(self):
        assert canonicalize("Django")[0] == "python"
        assert canonicalize("Rails")[0] == "ruby"

    def test_phrase_inside_a_longer_title(self):
        assert canonicalize("Senior React Developer")[0] == "react"

    def test_longest_alias_wins(self):
        # "react native" must not be shadowed by "react"
        assert canonicalize("React Native")[0] == "react_native"

    def test_unknown_skill_keeps_its_normalised_form(self):
        concept, known = canonicalize("Underwater Basket Weaving")
        assert known is False
        assert concept == "underwater basket weaving"

    def test_unknown_skills_still_match_each_other(self):
        assert canonicalize("Quantum Widgets")[0] == canonicalize("quantum  widgets")[0]

    def test_empty_input(self):
        assert canonicalize("") == ("", False)


class TestConcepts:
    def test_deduplicates_synonyms(self):
        # Three spellings of one concept collapse to one
        assert concepts_for(["React", "ReactJS", "react js"]) == {"react"}

    def test_distinct_skills_stay_distinct(self):
        assert len(concepts_for(["React", "Figma", "SEO"])) == 3

    def test_skips_blanks(self):
        assert concepts_for(["React", "", "  "]) == {"react"}

    def test_handles_none(self):
        assert concepts_for(None) == set()


class TestDomains:
    def test_maps_skills_to_domains(self):
        assert domains_for(["Figma", "Branding"]) == {"design"}

    def test_react_and_frontend_share_a_domain(self):
        # This is the bug the taxonomy exists to fix
        assert domains_for(["React"]) == domains_for(["Frontend"])

    def test_developer_and_designer_do_not_share_a_domain(self):
        dev = domains_for(["React", "Node.js"], "developer")
        designer = domains_for(["Figma", "UI/UX"], "designer")
        assert not (dev & designer)

    def test_profession_contributes_a_domain(self):
        # A profile whose skills are all unrecognised is still placed
        assert domains_for(["Nonexistent Skill"], "designer") == {"design"}

    def test_profession_only_profile_is_not_domainless(self):
        assert domains_for([], "sales") == {"sales"}

    def test_unknown_profession_is_ignored(self):
        assert domains_for(["Figma"], "wizard") == {"design"}

    def test_multi_domain_founder(self):
        assert domains_for(["React", "Figma", "SEO"]) == {"frontend", "design", "growth"}


class TestTaxonomyIntegrity:
    def test_every_concept_maps_to_a_declared_domain(self):
        for domain in PROFESSION_DOMAIN.values():
            assert domain in DOMAINS

    def test_every_skill_domain_is_declared(self):
        # Sweep the whole table through the public API
        from skills_taxonomy import _TAXONOMY  # noqa: PLC0415

        for concept, (domain, _aliases) in _TAXONOMY.items():
            assert domain in DOMAINS, f"{concept} has undeclared domain {domain}"

    def test_no_alias_is_claimed_by_two_concepts(self):
        from skills_taxonomy import _TAXONOMY  # noqa: PLC0415

        seen = {}
        for concept, (_domain, aliases) in _TAXONOMY.items():
            for alias in aliases:
                assert alias not in seen, f"'{alias}' claimed by {seen.get(alias)} and {concept}"
                seen[alias] = concept

    def test_every_profession_in_the_enum_has_a_domain(self):
        from models import Profession  # noqa: PLC0415

        for profession in Profession:
            assert profession.value in PROFESSION_DOMAIN, profession.value


class TestUnknownSkills:
    def test_reports_only_unrecognised_skills(self):
        assert unknown_skills(["React", "Blockchain Sorcery"]) == ["Blockchain Sorcery"]

    def test_empty_when_everything_is_known(self):
        assert unknown_skills(["React", "Figma", "SEO"]) == []
