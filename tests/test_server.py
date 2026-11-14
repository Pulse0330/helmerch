# -*- coding: utf-8 -*-
"""Серверийн тестүүд: орчуулгын кэш, «Миний үгс», шинэ хувилбар шалгах, /translate.
Ажиллуулах: python -m unittest tests/test_server.py   (эсвэл tests/run_tests.ps1)"""
import os
import sys
import json
import tempfile
import unittest

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "server"))
import hadmal_server as hs  # noqa: E402


class FakeTranslator:
    """Интернэтгүй орчуулагч: Google-ийн үг орчуулгыг дуурайна."""
    name = "Fake"
    gemini_key = github_token = claude = None

    def __init__(self):
        self.calls = 0

    def google_word(self, w):
        self.calls += 1
        return "МН-" + w, []


class Base(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.mkdtemp()
        self._old = (hs.TR_CACHE_FILE, hs.WORDS_FILE, hs.TRANSLATOR, hs.UPDATE_REPO)
        hs.TR_CACHE_FILE = os.path.join(self.tmp, "translations.json")
        hs.WORDS_FILE = os.path.join(self.tmp, "words.json")
        hs.TR_CACHE.clear()
        hs.WORDS.clear()
        hs.UPDATE.clear()

    def tearDown(self):
        hs.TR_CACHE_FILE, hs.WORDS_FILE, hs.TRANSLATOR, hs.UPDATE_REPO = self._old
        hs.TR_CACHE.clear()
        hs.WORDS.clear()


class TestWords(Base):
    def test_remember_and_count(self):
        hs.remember_word("Stakeholder", "оролцогч тал")
        hs.remember_word("stakeholder", "оролцогч тал")
        w = hs.WORDS["stakeholder"]
        self.assertEqual(w["n"], 2)
        self.assertEqual(w["w"], "Stakeholder")

    def test_ignores_non_words(self):
        for bad in ("оролцогч", "123", "two words", "a", "", "x" * 60):
            hs.remember_word(bad, "мн")
        hs.remember_word("scope", "")
        self.assertEqual(hs.WORDS, {})

    def test_learned_resets_on_lookup(self):
        hs.remember_word("baseline", "суурь")
        hs.word_update("baseline", learned=True)
        self.assertTrue(hs.WORDS["baseline"]["learned"])
        hs.remember_word("baseline", "суурь")
        self.assertFalse(hs.WORDS["baseline"]["learned"])

    def test_delete_and_persist(self):
        hs.remember_word("risk", "эрсдэл")
        hs.remember_word("scope", "хамрах хүрээ")
        self.assertTrue(hs.word_update("risk", delete=True))
        self.assertFalse(hs.word_update("missing", learned=True))
        hs.save_words()
        hs.WORDS.clear()
        hs.load_words()
        self.assertEqual(list(hs.WORDS), ["scope"])


class TestTranslationCache(Base):
    def test_roundtrip_keeps_tuple_keys(self):
        hs.TR_CACHE[("text", True, False, "Hello")] = {"mn": "Сайн уу"}
        hs._TR_DIRTY[0] = True
        hs.save_tr_cache()
        self.assertTrue(os.path.exists(hs.TR_CACHE_FILE))
        hs.TR_CACHE.clear()
        hs.load_tr_cache()
        self.assertEqual(hs.TR_CACHE[("text", True, False, "Hello")], {"mn": "Сайн уу"})

    def test_corrupt_file_is_ignored(self):
        with open(hs.TR_CACHE_FILE, "w", encoding="utf-8") as f:
            f.write("{эвдэрсэн")
        hs.load_tr_cache()      # алдаа шидэхгүй
        self.assertEqual(hs.TR_CACHE, {})


class TestTranslateApi(Base):
    def test_word_cached_and_remembered(self):
        fake = FakeTranslator()
        hs.TRANSLATOR = fake
        r1 = hs.api_translate({"kind": "word", "texts": ["charter"], "remember": True})
        r2 = hs.api_translate({"kind": "word", "texts": ["charter"]})
        self.assertEqual(r1["results"][0]["mn"], "МН-charter")
        self.assertEqual(r2["results"][0]["mn"], "МН-charter")
        self.assertEqual(fake.calls, 1, "хоёр дахь удаа кэшээс авах ёстой")
        self.assertIn("charter", hs.WORDS)
        self.assertEqual(hs.WORDS["charter"]["n"], 1, "remember-гүй хүсэлт тоологдох ёсгүй")


class TestUpdate(Base):
    def test_version_compare(self):
        self.assertGreater(hs._ver("v1.11.0"), hs._ver("1.10.9"))
        self.assertEqual(hs._ver("v1.10.1"), hs._ver("1.10.1"))

    def test_disabled_without_repo(self):
        hs.UPDATE_REPO = ""
        hs.check_update()
        self.assertEqual(hs.UPDATE, {})

    def test_newer_release_found(self):
        hs.UPDATE_REPO = "owner/repo"
        rel = {"tag_name": "v99.0.0", "body": "шинэ",
               "assets": [{"name": "Helmerch-Setup-99.0.0.exe", "browser_download_url": "https://x/setup.exe"}]}

        class R:
            def read(self):
                return json.dumps(rel).encode()
        old = hs.urllib.request.urlopen
        hs.urllib.request.urlopen = lambda *a, **k: R()
        try:
            hs.check_update()
        finally:
            hs.urllib.request.urlopen = old
        self.assertEqual(hs.UPDATE["version"], "99.0.0")
        self.assertTrue(hs.UPDATE["direct"])


if __name__ == "__main__":
    unittest.main()
