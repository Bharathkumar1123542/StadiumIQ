"""
Unit tests for StadiumIQ agent — pure-function test suite.

Run with:
    python -m pytest agent/tests/ -v
    # or doctest-only:
    python -m doctest agent/app/orchestrator.py -v
    python -m doctest agent/app/rag.py -v
"""
from __future__ import annotations

import pytest
from app.orchestrator import sanitize_input, moderate, detect_language


# ── sanitize_input ────────────────────────────────────────────────

class TestSanitizeInput:
    def test_strips_html_tags_but_preserves_content(self):
        # Tags are removed; text content between tags is kept
        assert sanitize_input("<b>hello</b> world") == "hello world"

    def test_strips_script_tag_preserves_content(self):
        # The tag brackets are removed; script content remains (LLM sees "alert(1)hello")
        result = sanitize_input("<script>alert(1)</script>hello")
        assert "<" not in result and ">" not in result

    def test_strips_html_with_attributes(self):
        result = sanitize_input('<a href="x">click</a>')
        assert "<" not in result and ">" not in result
        assert "click" in result

    def test_strips_control_characters(self):
        assert sanitize_input("hello\x00world") == "helloworld"

    def test_strips_form_feed(self):
        assert sanitize_input("line\x0cbreak") == "linebreak"

    def test_preserves_newline_and_tab(self):
        # \x09 (tab) and \x0a (newline) are NOT stripped
        assert "\t" in sanitize_input("hello\tworld")
        assert "\n" in sanitize_input("hello\nworld")

    def test_strips_whitespace(self):
        assert sanitize_input("  hello  ") == "hello"

    def test_empty_string(self):
        assert sanitize_input("") == ""

    def test_only_tags_becomes_empty(self):
        assert sanitize_input("<b></b>") == ""

    def test_no_modification_needed(self):
        assert sanitize_input("Where is the nearest restroom?") == "Where is the nearest restroom?"


# ── moderate ──────────────────────────────────────────────────────

class TestModerate:
    def test_safe_message(self):
        assert moderate("Where is the nearest restroom?") == "safe"

    def test_pii_ssn(self):
        assert moderate("my SSN is 123-45-6789") == "pii_leakage"

    def test_pii_credit_card(self):
        assert moderate("card number 4111111111111111") == "pii_leakage"

    def test_off_topic_bitcoin(self):
        assert moderate("what is bitcoin worth today?") == "off_topic"

    def test_off_topic_crypto(self):
        assert moderate("should I invest in crypto?") == "off_topic"

    def test_off_topic_election(self):
        assert moderate("who won the election?") == "off_topic"

    def test_competitor_brand_ticketmaster(self):
        assert moderate("I bought from ticketmaster") == "competitor_brand"

    def test_competitor_brand_stubhub(self):
        assert moderate("stubhub resale price?") == "competitor_brand"

    def test_case_insensitive_competitor(self):
        assert moderate("I used StubHub to buy my ticket") == "competitor_brand"

    def test_accessibility_question_safe(self):
        assert moderate("Which gates are wheelchair accessible?") == "safe"

    def test_emergency_question_safe(self):
        # Emergency content must NOT be blocked by moderate (handled by LLM tool)
        assert moderate("I need medical help, my child fell") == "safe"


# ── detect_language ───────────────────────────────────────────────

class TestDetectLanguage:
    def test_declared_code_respected(self):
        assert detect_language("hello world", "en") == "en"
        assert detect_language("مرحبا", "fr") == "fr"  # declared wins

    def test_auto_arabic(self):
        assert detect_language("مرحبا بالعالم", "auto") == "ar"

    def test_auto_japanese_hiragana(self):
        assert detect_language("こんにちは", "auto") == "ja"

    def test_auto_japanese_katakana(self):
        assert detect_language("スタジアム", "auto") == "ja"

    def test_auto_chinese(self):
        assert detect_language("你好世界", "auto") == "zh"

    def test_auto_korean(self):
        assert detect_language("안녕하세요", "auto") == "ko"

    def test_auto_hindi(self):
        assert detect_language("नमस्ते दुनिया", "auto") == "hi"

    def test_auto_french(self):
        assert detect_language("où est le stade?", "auto") == "fr"

    def test_auto_spanish(self):
        assert detect_language("dónde está el baño?", "auto") == "es"

    def test_auto_german(self):
        assert detect_language("wo ist das Stadion?", "auto") == "de"

    def test_auto_default_english(self):
        assert detect_language("where is the restroom?", "auto") == "en"

    def test_auto_empty_string(self):
        assert detect_language("", "auto") == "en"
