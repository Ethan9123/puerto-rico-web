#!/usr/bin/env python3
"""tools/extract_evolver_dna.py — 从 Tony Mitton 的 PuertoRicoEvolver(.xls) 提取 DNA 策略池。

这个 .xls(VBA 进化器, Author=Tony Mitton)是本仓库 L2「进化」AI(ai_dna.json)的来源。
每个个体的策略是一条 519 字符 DNA, 在 VBA(Manipulate_DNA.Save_DNA)里按固定切片存到工作表:

    段        长度  列(0-indexed)
    triggers   12    0
    role  ×3   46    2,4,6     (Early/Mid/Late)
    manning×3  89    8,10,12
    building×3 25    14,16,18
    plant ×3    9    20,22,24
    Games            26
    Score            28
    Name(Pos.id.Gen) 30

本脚本把 P1..P5 工作表里的个体重建成 ai_dna.json 同构的池(每条 = 13 段数组),
可用于:扩充/更新 ai_dna.json, 或与现有池做血脉/代际比对。

依赖: pip install xlrd        (xlrd 2.x 支持旧版 .xls)
用法:
    python tools/extract_evolver_dna.py <evolver.xls> --top 12 --out /tmp/pool.json
    python tools/extract_evolver_dna.py <evolver.xls> --compare ai_dna.json
"""
import argparse, json, re, sys

SEG  = [12, 46, 46, 46, 89, 89, 89, 25, 25, 25, 9, 9, 9]
COLS = [0, 2, 4, 6, 8, 10, 12, 14, 16, 18, 20, 22, 24]
GEN_RE = re.compile(r'G(\d+)')


def _segments(sheet, row):
    out = []
    for i, (c, L) in enumerate(zip(COLS, SEG)):
        s = str(sheet.cell_value(row, c))
        # triggers 是数字, Excel 存成 float("441977400805.0"); 其余是定宽字符串(含有意义的空格)
        out.append(s.split('.')[0] if i == 0 else s.ljust(L)[:L])
    return out


def extract(xls_path, top=12):
    import xlrd
    b = xlrd.open_workbook(xls_path, on_demand=True)
    pool = {}
    for pos in ['P1', 'P2', 'P3', 'P4', 'P5']:
        try:
            sh = b.sheet_by_name(pos)
        except Exception:
            continue
        seen, entries = set(), []
        for r in range(sh.nrows):                       # 表内已按 Score 降序 = 进化器自己的排名
            c2 = sh.cell_value(r, 2)
            if not (isinstance(c2, str) and len(c2) >= 40):
                continue
            seg = _segments(sh, r)
            key = ''.join(seg)
            if key in seen:
                continue
            seen.add(key)
            try:
                games = int(float(sh.cell_value(r, 26)))
                score = int(float(sh.cell_value(r, 28)))
            except Exception:
                games = score = 0
            entries.append({
                'avg': round(score / games, 4) if games else 0.0,
                'games': games, 'score': score,
                'name': str(sh.cell_value(r, 30)),
                'dna': [seg[0] + '.0'] + seg[1:],
            })
            if len(entries) >= top:
                break
        pool[pos] = entries
    return pool


def join_dna(parts):
    chr1 = str(parts[0]).split('.')[0].rjust(12, '0')[:12]
    return chr1 + ''.join(parts[1:])


def compare(pool, repo_path):
    repo = json.load(open(repo_path, encoding='utf-8'))
    # 把文件里所有(去重的)基因前缀收集起来, 看仓库的条目是否都出自此文件
    prefixes = set()
    for pos, es in pool.items():
        for e in es:
            prefixes.add(join_dna(e['dna'])[:160])
    total = match = 0
    repo_g, file_g = [], []
    for pos, es in repo.items():
        for e in es:
            total += 1
            if join_dna(e['dna'])[:160] in prefixes:
                match += 1
            m = GEN_RE.search(e.get('name', ''))
            if m:
                repo_g.append(int(m.group(1)))
    for pos, es in pool.items():
        for e in es:
            m = GEN_RE.search(e.get('name', ''))
            if m:
                file_g.append(int(m.group(1)))
    print(f"repo entries: {total}; prefix-matched in this file: {match}")
    if repo_g:
        print(f"repo generation span: G{min(repo_g)}..G{max(repo_g)}")
    if file_g:
        print(f"file generation span: G{min(file_g)}..G{max(file_g)}")


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('xls')
    ap.add_argument('--top', type=int, default=12)
    ap.add_argument('--out')
    ap.add_argument('--compare', metavar='ai_dna.json')
    a = ap.parse_args()
    pool = extract(a.xls, a.top)
    for pos, es in pool.items():
        print(f"{pos}: {len(es)} genomes; top = {[e['name'] for e in es[:3]]}")
    if a.out:
        json.dump(pool, open(a.out, 'w', encoding='utf-8'), ensure_ascii=False)
        print(f"wrote {a.out}")
    if a.compare:
        compare(pool, a.compare)


if __name__ == '__main__':
    main()
