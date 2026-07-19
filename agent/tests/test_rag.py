"""Unit tests for the VectorStore RAG module."""
from __future__ import annotations

import pytest
from app.rag import VectorStore, INLINE_DOCS


class TestKeywordSearch:
    """Tests for the TF-IDF keyword fallback search."""

    def setup_method(self):
        self.store = VectorStore()
        self.store._use_fallback = True
        self.store._fallback_docs = list(INLINE_DOCS)

    def test_returns_matching_docs(self):
        results = self.store._keyword_search("restroom", "metlife", top_k=3)
        assert len(results) > 0

    def test_result_contains_required_keys(self):
        results = self.store._keyword_search("restroom", "metlife", top_k=1)
        assert results, "Expected at least one result"
        r = results[0]
        assert "document_id" in r
        assert "title" in r
        assert "excerpt" in r
        assert "score" in r

    def test_score_between_zero_and_one(self):
        results = self.store._keyword_search("gate elevator accessibility", "metlife", top_k=5)
        for r in results:
            assert 0.0 <= r["score"] <= 1.0

    def test_venue_filter_works(self):
        """Docs for venue 'sofi' should not appear when searching 'metlife'."""
        # None of the inline docs have venueId=sofi, so result should be empty or only 'all' docs
        results = self.store._keyword_search("restroom", "sofi", top_k=3)
        for r in results:
            # All returned docs must be tagged 'all' since there are no sofi docs inline
            assert r["document_id"] in {d["id"] for d in INLINE_DOCS if d.get("venueId") in ("sofi", "all")}

    def test_no_match_returns_empty(self):
        results = self.store._keyword_search("xyzzy_no_match_zqq", "metlife", top_k=3)
        assert results == []

    def test_top_k_limits_results(self):
        results = self.store._keyword_search("level gate restroom elevator", "metlife", top_k=2)
        assert len(results) <= 2

    def test_results_sorted_by_score_descending(self):
        results = self.store._keyword_search("restroom gate level", "metlife", top_k=5)
        scores = [r["score"] for r in results]
        assert scores == sorted(scores, reverse=True)

    def test_excerpt_length_capped(self):
        results = self.store._keyword_search("restroom", "metlife", top_k=1)
        for r in results:
            assert len(r["excerpt"]) <= 200


class TestVectorStorePublicInterface:
    """Tests for the VectorStore.search() public method using the fallback path."""

    def setup_method(self):
        self.store = VectorStore()
        self.store._use_fallback = True
        self.store._fallback_docs = list(INLINE_DOCS)
        self.store._chroma_collection = None

    def test_search_delegates_to_keyword_on_fallback(self):
        results = self.store.search("restroom", venue_id="metlife", top_k=3)
        assert isinstance(results, list)

    def test_doc_count_zero_before_build(self):
        store = VectorStore()
        assert store.doc_count == 0
