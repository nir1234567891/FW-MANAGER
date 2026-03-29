import difflib
from typing import Optional


def compare_configs(config1: str, config2: str, context_lines: int = 3) -> str:
    lines1 = config1.splitlines(keepends=True)
    lines2 = config2.splitlines(keepends=True)

    diff = difflib.unified_diff(
        lines1,
        lines2,
        fromfile="config_old",
        tofile="config_new",
        lineterm="",
        n=context_lines,
    )
    return "\n".join(diff)


def parse_fortigate_config(config_text: str) -> dict[str, str]:
    sections: dict[str, str] = {}
    current_section: Optional[str] = None
    current_lines: list[str] = []
    depth = 0

    for line in config_text.splitlines():
        stripped = line.strip()

        if stripped.startswith("config ") or stripped.startswith("edit "):
            if depth == 0:
                current_section = stripped
                current_lines = [line]
            else:
                current_lines.append(line)
            depth += 1
        elif stripped in ("end", "next"):
            current_lines.append(line)
            depth -= 1
            if depth <= 0:
                depth = 0
                if current_section:
                    sections[current_section] = "\n".join(current_lines)
                current_section = None
                current_lines = []
        else:
            if current_section:
                current_lines.append(line)
            else:
                key = stripped[:60] if stripped else "header"
                if key not in sections:
                    sections[key] = ""
                sections[key] += line + "\n"

    if current_section and current_lines:
        sections[current_section] = "\n".join(current_lines)

    return sections


def get_section_diff(
    config1: str, config2: str, section_name: str, context_lines: int = 3
) -> Optional[str]:
    sections1 = parse_fortigate_config(config1)
    sections2 = parse_fortigate_config(config2)

    matched_key1 = None
    matched_key2 = None
    for key in sections1:
        if section_name.lower() in key.lower():
            matched_key1 = key
            break
    for key in sections2:
        if section_name.lower() in key.lower():
            matched_key2 = key
            break

    text1 = sections1.get(matched_key1, "") if matched_key1 else ""
    text2 = sections2.get(matched_key2, "") if matched_key2 else ""

    if not text1 and not text2:
        return None

    return compare_configs(text1, text2, context_lines)


def highlight_changes(config1: str, config2: str) -> dict:
    lines1 = config1.splitlines()
    lines2 = config2.splitlines()

    matcher = difflib.SequenceMatcher(None, lines1, lines2)
    additions: list[dict] = []
    deletions: list[dict] = []
    modifications: list[dict] = []

    for tag, i1, i2, j1, j2 in matcher.get_opcodes():
        if tag == "equal":
            continue
        elif tag == "insert":
            for idx in range(j1, j2):
                additions.append({
                    "line_number": idx + 1,
                    "content": lines2[idx],
                    "section": _identify_section(lines2, idx),
                })
        elif tag == "delete":
            for idx in range(i1, i2):
                deletions.append({
                    "line_number": idx + 1,
                    "content": lines1[idx],
                    "section": _identify_section(lines1, idx),
                })
        elif tag == "replace":
            old_lines = lines1[i1:i2]
            new_lines = lines2[j1:j2]
            modifications.append({
                "old_start": i1 + 1,
                "old_end": i2,
                "new_start": j1 + 1,
                "new_end": j2,
                "old_content": old_lines,
                "new_content": new_lines,
                "section": _identify_section(lines1, i1),
            })

    sections1 = set(parse_fortigate_config(config1).keys())
    sections2 = set(parse_fortigate_config(config2).keys())

    return {
        "additions_count": len(additions),
        "deletions_count": len(deletions),
        "modifications_count": len(modifications),
        "additions": additions,
        "deletions": deletions,
        "modifications": modifications,
        "sections_added": list(sections2 - sections1),
        "sections_removed": list(sections1 - sections2),
        "total_lines_old": len(lines1),
        "total_lines_new": len(lines2),
    }


def _identify_section(lines: list[str], index: int) -> str:
    for i in range(index, -1, -1):
        stripped = lines[i].strip()
        if stripped.startswith("config "):
            return stripped
        if stripped.startswith("edit "):
            for j in range(i, -1, -1):
                if lines[j].strip().startswith("config "):
                    return f"{lines[j].strip()} > {stripped}"
            return stripped
    return "global"
