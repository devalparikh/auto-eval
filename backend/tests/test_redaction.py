from autoeval_api.redaction import redact_payload, redact_text


def test_redaction_handles_credentials_in_free_text_and_dictionary_keys():
    value = {"person@example.com": ["password=private", "postgresql://user:private@db.local/app"]}
    assert redact_payload(value) == {
        "[redacted]": ["password=[redacted]", "postgresql://[redacted]@db.local/app"]
    }


def test_redaction_handles_long_nonmatches_without_unbounded_backtracking():
    for value in ("a." * 100_000, "a" * 200_000, "http://user:" + ":" * 200_000):
        assert redact_text(value) == value
