from __future__ import annotations

import ast
import re
from dataclasses import dataclass
from pathlib import PurePosixPath

LANGUAGES = {
    ".c": "C",
    ".cc": "C++",
    ".cpp": "C++",
    ".css": "CSS",
    ".go": "Go",
    ".h": "C/C++",
    ".html": "HTML",
    ".java": "Java",
    ".js": "JavaScript",
    ".jsx": "JavaScript",
    ".kt": "Kotlin",
    ".md": "Markdown",
    ".mdx": "MDX",
    ".mjs": "JavaScript",
    ".php": "PHP",
    ".py": "Python",
    ".pyi": "Python",
    ".rb": "Ruby",
    ".rs": "Rust",
    ".scss": "SCSS",
    ".sh": "Shell",
    ".sql": "SQL",
    ".swift": "Swift",
    ".toml": "TOML",
    ".ts": "TypeScript",
    ".tsx": "TypeScript",
    ".vue": "Vue",
    ".yaml": "YAML",
    ".yml": "YAML",
}
JS_SYMBOL_PATTERN = re.compile(
    r"^(?:export\s+(?:default\s+)?)?(?:(async)\s+)?"
    r"(function|class|const|let|var)\s+([A-Za-z_$][\w$]*)",
    re.MULTILINE,
)
JS_IMPORT_PATTERN = re.compile(
    r"(?:import|export)\s+(?:[\s\S]*?\s+from\s+)?[\"']([^\"']+)[\"']"
    r"|require\(\s*[\"']([^\"']+)[\"']\s*\)"
)
GENERIC_SYMBOL_PATTERN = re.compile(
    r"^\s*(?:pub(?:lic)?\s+|private\s+|protected\s+|static\s+|async\s+)*"
    r"(class|struct|enum|interface|protocol|trait|func|function|fn|def)\s+"
    r"([A-Za-z_][\w]*)",
    re.MULTILINE,
)
MARKDOWN_HEADING_PATTERN = re.compile(r"^(#{1,3})\s+(.+?)\s*$", re.MULTILINE)


@dataclass(frozen=True)
class ParsedSymbol:
    name: str
    kind: str
    line: int


@dataclass(frozen=True)
class ImportReference:
    module: str
    level: int = 0


@dataclass(frozen=True)
class ParsedFile:
    path: str
    language: str
    lines: int
    symbols: tuple[ParsedSymbol, ...]
    imports: tuple[ImportReference, ...]


def parse_file(path: str, content: str, max_symbols: int = 24) -> ParsedFile:
    suffix = PurePosixPath(path).suffix.lower()
    language = LANGUAGES.get(suffix, suffix.removeprefix(".").upper() or "Text")
    line_count = content.count("\n") + (1 if content else 0)
    if suffix in {".py", ".pyi"}:
        symbols, imports = _parse_python(content)
    elif suffix in {".js", ".jsx", ".mjs", ".ts", ".tsx", ".vue"}:
        symbols, imports = _parse_javascript(content)
    elif suffix in {".md", ".mdx"}:
        symbols = _parse_markdown(content)
        imports = []
    else:
        symbols = _parse_generic(content)
        imports = []
    return ParsedFile(
        path=path,
        language=language,
        lines=line_count,
        symbols=tuple(symbols[:max_symbols]),
        imports=tuple(imports),
    )


def _parse_python(content: str) -> tuple[list[ParsedSymbol], list[ImportReference]]:
    try:
        tree = ast.parse(content)
    except SyntaxError:
        return [], []
    symbols: list[ParsedSymbol] = []
    imports: list[ImportReference] = []
    for node in tree.body:
        if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
            symbols.append(ParsedSymbol(node.name, "function", node.lineno))
        elif isinstance(node, ast.ClassDef):
            symbols.append(ParsedSymbol(node.name, "class", node.lineno))
        elif isinstance(node, ast.Import):
            imports.extend(ImportReference(alias.name) for alias in node.names)
        elif isinstance(node, ast.ImportFrom):
            imports.append(ImportReference(node.module or "", node.level))
    return symbols, imports


def _parse_javascript(content: str) -> tuple[list[ParsedSymbol], list[ImportReference]]:
    symbols = [
        ParsedSymbol(
            match.group(3),
            "function" if match.group(2) == "function" else match.group(2),
            content.count("\n", 0, match.start()) + 1,
        )
        for match in JS_SYMBOL_PATTERN.finditer(content)
    ]
    imports = [
        ImportReference(match.group(1) or match.group(2))
        for match in JS_IMPORT_PATTERN.finditer(content)
    ]
    return symbols, imports


def _parse_markdown(content: str) -> list[ParsedSymbol]:
    return [
        ParsedSymbol(
            match.group(2).strip(),
            "section",
            content.count("\n", 0, match.start()) + 1,
        )
        for match in MARKDOWN_HEADING_PATTERN.finditer(content)
    ]


def _parse_generic(content: str) -> list[ParsedSymbol]:
    return [
        ParsedSymbol(
            match.group(2),
            match.group(1),
            content.count("\n", 0, match.start()) + 1,
        )
        for match in GENERIC_SYMBOL_PATTERN.finditer(content)
    ]
