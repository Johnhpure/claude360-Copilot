#!/usr/bin/env python3
"""基于品牌源 Logo 生成 Claude360 Copilot 的多尺寸应用/打包图标。

用法:
    python3 scripts/generate-icons.py [--source <png>]

默认源图: build/brand/claude360-copilot-logo.png（随仓库存档，未来换 Logo 覆盖此文件后一键重生）。

输出（覆盖式、幂等）:
    src/asset/img/claude360.png       1024x1024      主图标 / Linux AppImage / 渲染进程
    src/asset/img/claude360_mac.png   1024x1024      macOS（electron-builder 自动转 icns，需 RGBA 透明圆角）
    src/asset/img/claude360_tray.png  256x256        系统托盘
    build/icon-claude360.ico          16~256 多尺寸   Windows Explorer / 任务栏 / 快捷方式

设计取舍: 仅依赖 Python Pillow（系统已装），零 Node 依赖，不改 package.json，
与体积优化任务零冲突。ICO 由 Pillow 原生多尺寸输出。
"""
import argparse
import os
import sys

try:
    from PIL import Image
except ImportError:
    sys.exit("需要 Pillow: pip install Pillow")

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)  # claude360-Copilot/

DEFAULT_SOURCE = os.path.join(ROOT, "build", "brand", "claude360-copilot-logo.png")
ICO_SIZES = [16, 24, 32, 48, 64, 128, 256]

# 目标 PNG: 相对路径 -> 边长
PNG_TARGETS = {
    os.path.join("src", "asset", "img", "claude360.png"): 1024,
    os.path.join("src", "asset", "img", "claude360_mac.png"): 1024,
    os.path.join("src", "asset", "img", "claude360_tray.png"): 256,
}


def load_source(path: str) -> Image.Image:
    """读入源图并规整为正方形 RGBA。"""
    img = Image.open(path).convert("RGBA")
    w, h = img.size
    if w != h:
        # 防御性居中裁方（App 图标通常本就是正方形）。
        side = min(w, h)
        left = (w - side) // 2
        top = (h - side) // 2
        img = img.crop((left, top, left + side, top + side))
    return img


def resized(img: Image.Image, size: int) -> Image.Image:
    return img.resize((size, size), Image.LANCZOS)


def main() -> None:
    parser = argparse.ArgumentParser(description="生成 Claude360 Copilot 多尺寸图标")
    parser.add_argument("--source", default=DEFAULT_SOURCE, help="品牌源 Logo PNG 路径")
    args = parser.parse_args()

    if not os.path.isfile(args.source):
        sys.exit(f"源图不存在: {args.source}")

    src = load_source(args.source)
    print(f"源图: {args.source}  {src.size[0]}x{src.size[1]}")

    for rel, size in PNG_TARGETS.items():
        dst = os.path.join(ROOT, rel)
        os.makedirs(os.path.dirname(dst), exist_ok=True)
        resized(src, size).save(dst, "PNG")
        print(f"[png] {rel}  {size}x{size}")

    ico_path = os.path.join(ROOT, "build", "icon-claude360.ico")
    os.makedirs(os.path.dirname(ico_path), exist_ok=True)
    # 以 256 底图交给 Pillow 生成多尺寸 ICO（内部按 sizes 逐一 downscale 并封装）。
    resized(src, 256).save(ico_path, format="ICO", sizes=[(s, s) for s in ICO_SIZES])
    print(f"[ico] build/icon-claude360.ico  {ICO_SIZES}")

    print("完成。")


if __name__ == "__main__":
    main()
