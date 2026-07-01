import httpx
import logging
from bs4 import BeautifulSoup
import urllib.parse

logger = logging.getLogger(__name__)


async def fetch_page_text(url: str, max_chars: int = 3000) -> str:
    """Fetch a URL and extract readable text from it."""
    try:
        async with httpx.AsyncClient(timeout=10, follow_redirects=True) as client:
            headers = {"User-Agent": "Mozilla/5.0 (compatible; InterviewBot/1.0)"}
            res = await client.get(url, headers=headers)
            res.raise_for_status()
            soup = BeautifulSoup(res.text, "html.parser")
            for tag in soup(["script", "style", "nav", "footer", "header"]):
                tag.decompose()
            # Extract text from meaningful tags
            texts = []
            for tag in soup.find_all(["h1", "h2", "h3", "p"]):
                t = tag.get_text(strip=True)
                if len(t) > 15:
                    texts.append(t)
            return "\n".join(texts)[:max_chars]
    except Exception as e:
        logger.warning("fetch_page_text failed for %s: %s", url, e)
        return ""


async def fetch_company_info_by_name(company_name: str) -> str:
    """
    Fetch company information by name using free APIs (no API key required).
    Tries Wikipedia first (with name variations), then DuckDuckGo Instant Answer API.
    Returns a text string with whatever info was found.
    """
    # Try multiple name variations for better Wikipedia matching
    name_variants = [company_name]
    if not company_name.endswith(("株式会社", "工業", "電機", "化学", "商事", "物産", "銀行", "グループ")):
        name_variants.append(company_name + "株式会社")
    if "株式会社" not in company_name:
        name_variants.append("株式会社" + company_name)

    for name in name_variants:
        encoded = urllib.parse.quote(name)
        wiki_text = await _try_wikipedia(encoded)
        if wiki_text:
            return wiki_text

    # Fallback: DuckDuckGo Instant Answer API (official free endpoint, not scraping)
    encoded = urllib.parse.quote(company_name)
    ddg_text = await _try_duckduckgo_instant(encoded)
    if ddg_text:
        return ddg_text

    return ""


async def _try_wikipedia(encoded_name: str) -> str:
    """Try Japanese Wikipedia summary API."""
    try:
        url = f"https://ja.wikipedia.org/api/rest_v1/page/summary/{encoded_name}"
        async with httpx.AsyncClient(timeout=8, follow_redirects=True) as client:
            headers = {"User-Agent": "InterviewBot/1.0 (interview-assistant)"}
            res = await client.get(url, headers=headers)
            if res.status_code == 200:
                data = res.json()
                extract = data.get("extract", "")
                title = data.get("title", "")
                if extract and len(extract) > 50:
                    return f"Wikipedia「{title}」より:\n{extract}"
    except Exception:
        pass
    return ""


async def _try_duckduckgo_instant(encoded_name: str) -> str:
    """Try DuckDuckGo Instant Answer API (free official JSON endpoint, not scraping)."""
    try:
        url = f"https://api.duckduckgo.com/?q={encoded_name}&format=json&no_html=1&skip_disambig=1"
        async with httpx.AsyncClient(timeout=8, follow_redirects=True) as client:
            headers = {"User-Agent": "InterviewBot/1.0 (interview-assistant)"}
            res = await client.get(url, headers=headers)
            if res.status_code == 200:
                data = res.json()
                parts = []

                abstract = data.get("Abstract", "")
                if abstract:
                    parts.append(f"概要: {abstract}")

                answer = data.get("Answer", "")
                if answer:
                    parts.append(f"回答: {answer}")

                # Related topics
                related = data.get("RelatedTopics", [])
                snippets = []
                for item in related[:5]:
                    if isinstance(item, dict) and item.get("Text"):
                        snippets.append(item["Text"])
                if snippets:
                    parts.append("関連情報:\n" + "\n".join(snippets))

                if parts:
                    return "\n\n".join(parts)
    except Exception:
        pass
    return ""
