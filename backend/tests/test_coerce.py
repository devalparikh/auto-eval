from math import inf, nan

from autoeval_api.coerce import (
    dict_list,
    integer,
    number,
    optional_integer,
    optional_number,
    round_amount,
    string_list,
)


def test_dict_list_keeps_only_mappings():
    assert dict_list([{"a": 1}, 2, None, {"b": 2}]) == [{"a": 1}, {"b": 2}]
    assert dict_list("not a list") == []
    assert dict_list(None) == []


def test_string_list_stringifies_every_item():
    assert string_list(["a", 1, None]) == ["a", "1", "None"]
    assert string_list({"a": 1}) == []


def test_number_falls_back_on_unreadable_values():
    assert number("1.5") == 1.5
    assert number(None) == 0.0
    assert number("abc") == 0.0
    assert number(None, default=-1.0) == -1.0


def test_optional_number_rejects_nan_but_keeps_infinity():
    assert optional_number("2") == 2.0
    assert optional_number(nan) is None
    assert optional_number(None) is None
    assert optional_number(inf) == inf


def test_integer_truncates_and_falls_back():
    assert integer("3") == 3
    assert integer(3.9) == 3
    assert integer("x", default=7) == 7
    assert optional_integer("x") is None
    assert optional_integer(4.2) == 4


def test_round_amount_uses_the_shared_precision():
    assert round_amount(1 / 3) == 0.333333
