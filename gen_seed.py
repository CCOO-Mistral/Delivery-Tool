"""Regenerate seed.json from the original requirements workbook.

Usage: python3 gen_seed.py [path-to-xlsx]
Defaults to the uploaded requirements file; output is written next to this
script as seed.json. The app loads seed.json at first start, so this script
only needs to be re-run if the requirements workbook changes.
"""
import json
import os
import re
import sys
import zipfile
import xml.etree.ElementTree as ET

PATH = sys.argv[1] if len(sys.argv) > 1 else "/mnt/vibefs/uploads/c54e7fe9-d6bd-4b1b-9c9b-963ea3a1faa2/OA8CJFf5-Tool Mistral.xlsx"
NS = {"m": "http://schemas.openxmlformats.org/spreadsheetml/2006/main",
      "r": "http://schemas.openxmlformats.org/officeDocument/2006/relationships"}


def load_sheets(path):
    z = zipfile.ZipFile(path)
    shared = []
    if "xl/sharedStrings.xml" in z.namelist():
        root = ET.fromstring(z.read("xl/sharedStrings.xml"))
        for si in root.findall("m:si", NS):
            shared.append("".join(t.text or "" for t in si.iter("{%s}t" % NS["m"])))
    wb = ET.fromstring(z.read("xl/workbook.xml"))
    rels = ET.fromstring(z.read("xl/_rels/workbook.xml.rels"))
    relmap = {rel.get("Id"): rel.get("Target") for rel in rels}
    sheets = {}
    for sheet in wb.find("m:sheets", NS):
        target = relmap[sheet.get("{%s}id" % NS["r"])]
        if not target.startswith("xl/"):
            target = "xl/" + target.lstrip("/")
        rows = []
        for row in ET.fromstring(z.read(target)).iter("{%s}row" % NS["m"]):
            cells = {}
            maxc = -1
            for c in row.findall("m:c", NS):
                mm = re.match(r"([A-Z]+)(\d+)", c.get("r"))
                col = 0
                for ch in mm.group(1):
                    col = col * 26 + (ord(ch) - 64)
                ci = col - 1
                maxc = max(maxc, ci)
                t = c.get("t")
                v = c.find("m:v", NS)
                is_el = c.find("m:is", NS)
                if t == "s" and v is not None:
                    val = shared[int(v.text)]
                elif t == "inlineStr" and is_el is not None:
                    val = "".join(x.text or "" for x in is_el.iter("{%s}t" % NS["m"]))
                elif v is not None:
                    val = v.text
                else:
                    val = ""
                cells[ci] = (val or "").strip()
            if cells:
                rows.append([cells.get(i, "") for i in range(maxc + 1)])
        sheets[sheet.get("name")] = rows
    return sheets


def cell(r, i):
    return r[i] if i < len(r) else ""


def main():
    sheets = load_sheets(PATH)

    phases, gates, milestones, m_by_no = [], [], [], {}
    for r in sheets["WBS"]:
        if cell(r, 1).isdigit() and cell(r, 2):
            phases.append({"num": cell(r, 1), "name": cell(r, 2)})
        if cell(r, 4).isdigit() and cell(r, 5):
            gates.append({"num": cell(r, 4), "name": cell(r, 5)})
        mno = None
        if cell(r, 7).isdigit():
            mno = cell(r, 7)
            if mno not in m_by_no:
                m_by_no[mno] = {"num": mno, "name": cell(r, 8), "gate": cell(r, 9), "activities": []}
                milestones.append(m_by_no[mno])
        elif cell(r, 11).isdigit() and cell(r, 11) in m_by_no:
            mno = cell(r, 11)
        if mno and cell(r, 12):
            m_by_no[mno]["activities"].append(
                {"name": cell(r, 12), "doc_ref": cell(r, 13), "owner": cell(r, 14)})

    wbs_standard = []
    for p in phases:
        wbs_standard.append({"code": p["num"], "type": "phase", "name": p["name"],
                             "parent": "", "doc_ref": "", "owner": ""})
    for g in gates:
        wbs_standard.append({"code": f'{g["num"]}.{g["num"]}', "type": "gate", "name": g["name"],
                             "parent": g["num"], "doc_ref": "", "owner": ""})
    for m in sorted(milestones, key=lambda x: int(x["num"])):
        code = f'{m["gate"]}.{m["gate"]}.{m["num"]}'
        wbs_standard.append({"code": code, "type": "milestone", "name": m["name"],
                             "parent": f'{m["gate"]}.{m["gate"]}', "doc_ref": "", "owner": ""})
        for i, a in enumerate(m["activities"], start=1):
            wbs_standard.append({"code": f"{code}.{i}", "type": "activity", "name": a["name"],
                                 "parent": code, "doc_ref": a["doc_ref"], "owner": a["owner"]})

    timeline = []
    for r in sheets["Timeline"]:
        if cell(r, 1).isdigit():
            timeline.append({"num": int(cell(r, 1)), "name": cell(r, 2),
                             "week": int(float(cell(r, 3) or 0))})

    doc_templates = []
    header_seen = False
    for r in sheets["Documents"]:
        if cell(r, 1) == "Project Phase" and cell(r, 2) == "Consolidated":
            header_seen = True
            continue
        if header_seen and (cell(r, 1) or cell(r, 2)):
            row = [cell(r, 1 + i) for i in range(22)]
            doc_templates.append({
                "phase": row[0], "consolidated": row[1], "code": row[2], "description": row[3],
                "seq": row[4], "doc_name": row[5], "template": row[6], "sample": row[7],
                "owner": row[8], "reviewer": row[9], "approver": row[10],
                "rina": row[11], "abs": row[12], "customer": row[13], "internal": row[14],
                "hard_copies": row[15],
                "gate1": row[16], "gate2": row[17], "gate3": row[18],
                "gate4": row[19], "gate5": row[20], "comment": row[21],
            })

    seed = {"wbs_standard": wbs_standard,
            "timeline": sorted(timeline, key=lambda x: x["num"]),
            "document_templates": doc_templates}
    out = os.path.join(os.path.dirname(os.path.abspath(__file__)), "seed.json")
    with open(out, "w", encoding="utf-8") as f:
        json.dump(seed, f, ensure_ascii=False, indent=1)
    print(f"wrote {out}: {len(phases)} phases, {len(gates)} gates, {len(milestones)} milestones, "
          f"{sum(len(m['activities']) for m in milestones)} activities, "
          f"{len(timeline)} timeline milestones, {len(doc_templates)} document templates")


if __name__ == "__main__":
    main()
