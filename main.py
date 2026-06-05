"""AI 小说转剧本工具 — CLI entry point.

Usage:
    python main.py input.txt -o output.yaml
    python main.py input.md -o output.yaml --model claude-sonnet-4-6
    python main.py input.docx --no-llm -o template.yaml
"""

from __future__ import annotations

import logging
import sys
from pathlib import Path

import typer
from rich.console import Console
from rich.logging import RichHandler


from src.converter import NovelToScriptConverter

app = typer.Typer(
    name="novel2script",
    help="将小说文本转换为结构化 YAML 剧本",
    add_completion=False,
)

console = Console(force_terminal=True, legacy_windows=False)


def setup_logging(verbose: bool = False) -> None:
    level = logging.DEBUG if verbose else logging.INFO
    logging.basicConfig(
        level=level,
        format="%(message)s",
        handlers=[RichHandler(console=console, rich_tracebacks=True, show_time=False)],
    )


@app.command()
def convert(
    input_file: str = typer.Argument(..., help="输入小说文件路径 (txt/md/docx/pdf)"),
    output: str = typer.Option("screenplay_output.yaml", "--output", "-o", help="输出 YAML 文件路径"),
    config: str = typer.Option("config.yaml", "--config", "-c", help="配置文件路径"),
    no_llm: bool = typer.Option(False, "--no-llm", help="禁用 LLM，仅生成结构模板"),
    model: str = typer.Option("", "--model", "-m", help="覆盖配置文件中的模型名称"),
    verbose: bool = typer.Option(False, "--verbose", "-v", help="输出详细日志"),
):
    """将小说文件转换为结构化剧本 YAML。"""
    setup_logging(verbose)

    # Validate input
    if not Path(input_file).exists():
        console.print(f"[red]错误：文件不存在 — {input_file}[/red]")
        raise typer.Exit(code=1)

    valid_exts = {".txt", ".md", ".markdown", ".docx", ".doc", ".pdf"}
    ext = Path(input_file).suffix.lower()
    if ext not in valid_exts:
        console.print(f"[red]错误：不支持的文件格式 '{ext}'[/red]")
        console.print(f"支持的格式：{', '.join(sorted(valid_exts))}")
        raise typer.Exit(code=1)

    console.print(f"[bold]AI 小说转剧本工具[/bold]")
    console.print(f"  输入：{input_file}")
    console.print(f"  输出：{output}")
    console.print(f"  LLM：{'禁用' if no_llm else '启用'}")

    try:
        console.print("正在转换...")

        converter = NovelToScriptConverter(config_path=config)

        # Override model if specified
        if model and converter.llm:
            converter.llm.model = model

        screenplay = converter.convert(
            input_file,
            output,
            use_llm=not no_llm,
        )

        console.print()
        console.print(f"[green]转换完成[/green]")
        console.print(f"  剧本标题：{screenplay.meta.title}")
        console.print(f"  角色数量：{len(screenplay.characters)}")
        console.print(f"  幕数：{screenplay.meta.total_acts}")
        console.print(f"  总场数：{screenplay.meta.total_scenes}")
        console.print(f"  输出文件：{Path(output).resolve()}")

        # Show evaluation report
        eval_path = Path(output).with_suffix(".eval.txt")
        if eval_path.exists():
            console.print(f"  评估报告：{eval_path.resolve()}")
            for line in eval_path.read_text(encoding="utf-8").splitlines():
                if "综合评分" in line:
                    console.print(f"  {line.strip()}")
                    break

        # Print character summary
        if screenplay.characters:
            console.print()
            console.print("[bold]角色列表：[/bold]")
            for c in screenplay.characters:
                role_icon = {"protagonist": "*", "antagonist": "^", "supporting": "+", "minor": "-"}
                icon = role_icon.get(c.role.value if hasattr(c.role, 'value') else c.role, " ")
                console.print(f"  {icon} {c.name} ({c.role.value if hasattr(c.role, 'value') else c.role})")

    except Exception as e:
        console.print(f"[red]转换失败：{e}[/red]")
        if verbose:
            console.print_exception()
        raise typer.Exit(code=1)


@app.command()
def validate(
    yaml_file: str = typer.Argument(..., help="要验证的 YAML 剧本文件路径"),
):
    """验证一个已有的剧本 YAML 文件是否符合 Schema。"""
    setup_logging()

    path = Path(yaml_file)
    if not path.exists():
        console.print(f"[red]错误：文件不存在 — {yaml_file}[/red]")
        raise typer.Exit(code=1)

    try:
        from src.schema import ScreenplayYAML
        yaml_str = path.read_text(encoding="utf-8")
        screenplay = ScreenplayYAML.parse_yaml(yaml_str)
        console.print(f"[green]验证通过[/green]")
        console.print(f"  标题：{screenplay.meta.title}")
        console.print(f"  角色：{len(screenplay.characters)} 个")
        console.print(f"  幕：{screenplay.meta.total_acts} / 场：{screenplay.meta.total_scenes}")
    except Exception as e:
        console.print(f"[red]验证失败：{e}[/red]")
        raise typer.Exit(code=1)


if __name__ == "__main__":
    app()
