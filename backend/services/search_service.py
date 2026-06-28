import asyncio
import httpx
from duckduckgo_search import DDGS
from bs4 import BeautifulSoup


def _sync_search(query: str, max_results: int) -> list[dict]:
    with DDGS() as ddgs:
        results = []
        for r in ddgs.text(query, region="jp-jp", max_results=max_results):
            results.append({
                "title": r["title"],
                "url": r["href"],
                "snippet": r["body"],
            })
        return results


async def search_company(company_name: str) -> list[dict]:
    query = f"{company_name} 会社概要 事業内容 企業文化 採用"
    try:
        results = await asyncio.to_thread(_sync_search, query, 6)
        return results
    except Exception:
        return []


async def search_reviews(company_name: str) -> list[dict]:
    await asyncio.sleep(1.5)
    query = f"{company_name} 口コミ 評判 社員 働きやすさ"
    try:
        results = await asyncio.to_thread(_sync_search, query, 5)
        return results
    except Exception:
        return []


async def fetch_page_text(url: str, max_chars: int = 1500) -> str:
    try:
        async with httpx.AsyncClient(timeout=8, follow_redirects=True) as client:
            headers = {"User-Agent": "Mozilla/5.0 (compatible; InterviewBot/1.0)"}
            res = await client.get(url, headers=headers)
            soup = BeautifulSoup(res.text, "html.parser")
            for tag in soup(["script", "style", "nav", "footer", "header"]):
                tag.decompose()
            text = soup.get_text(separator="\n", strip=True)
            lines = [l for l in text.splitlines() if len(l) > 20]
            return "\n".join(lines)[:max_chars]
    except Exception:
        return ""
