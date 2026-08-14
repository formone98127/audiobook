"""Lumina RSVP YouTube video generator — tkinter GUI."""
from __future__ import annotations

import sys
import threading
import traceback
from pathlib import Path

# Allow `python gui.py` from this folder
sys.path.insert(0, str(Path(__file__).resolve().parent))

import tkinter as tk
from tkinter import filedialog, messagebox, ttk

from books import Book, scan_books
from lumina import PRESETS
from render import ffmpeg_bin, output_name, render_chapter

REPO = Path(__file__).resolve().parents[2]


class App(tk.Tk):
    def __init__(self) -> None:
        super().__init__()
        self.title("Lumina RSVP — video")
        self.geometry("720x640")
        self.minsize(640, 520)
        self.books: list[Book] = scan_books()
        self.out_dir = tk.StringVar(value=str(REPO / "out" / "rsvp-video"))
        self.preset = tk.StringVar(value="1080p")
        self.theme = tk.StringVar(value="light")
        self.lead = tk.StringVar(value="0.2")
        self.status = tk.StringVar(value="Ready")
        self.busy = False
        self._build()

    def _build(self) -> None:
        pad = {"padx": 12, "pady": 6}
        frm = ttk.Frame(self)
        frm.pack(fill=tk.BOTH, expand=True)

        ttk.Label(frm, text="Book").grid(row=0, column=0, sticky="w", **pad)
        self.book_cb = ttk.Combobox(
            frm,
            state="readonly",
            values=[f"{b.title} ({b.id})" for b in self.books],
            width=56,
        )
        self.book_cb.grid(row=0, column=1, columnspan=2, sticky="ew", **pad)
        if self.books:
            self.book_cb.current(0)
        self.book_cb.bind("<<ComboboxSelected>>", lambda _e: self._fill_chapters())

        ttk.Label(frm, text="Chapters").grid(row=1, column=0, sticky="nw", **pad)
        self.chap_list = tk.Listbox(frm, selectmode=tk.EXTENDED, height=10, exportselection=False)
        self.chap_list.grid(row=1, column=1, columnspan=2, sticky="nsew", **pad)
        self._fill_chapters()

        ttk.Label(frm, text="Preset").grid(row=2, column=0, sticky="w", **pad)
        preset_row = ttk.Frame(frm)
        preset_row.grid(row=2, column=1, sticky="w", **pad)
        ttk.Radiobutton(preset_row, text="16:9 1080p", variable=self.preset, value="1080p").pack(side=tk.LEFT, padx=(0, 16))
        ttk.Radiobutton(preset_row, text="9:16 Shorts", variable=self.preset, value="shorts").pack(side=tk.LEFT)

        ttk.Label(frm, text="Theme").grid(row=3, column=0, sticky="w", **pad)
        theme_row = ttk.Frame(frm)
        theme_row.grid(row=3, column=1, sticky="w", **pad)
        ttk.Radiobutton(theme_row, text="Light", variable=self.theme, value="light").pack(side=tk.LEFT, padx=(0, 16))
        ttk.Radiobutton(theme_row, text="Dark", variable=self.theme, value="dark").pack(side=tk.LEFT)

        ttk.Label(frm, text="Text lead (s)").grid(row=4, column=0, sticky="w", **pad)
        ttk.Entry(frm, textvariable=self.lead, width=8).grid(row=4, column=1, sticky="w", **pad)

        ttk.Label(frm, text="Output").grid(row=5, column=0, sticky="w", **pad)
        ttk.Entry(frm, textvariable=self.out_dir).grid(row=5, column=1, sticky="ew", **pad)
        ttk.Button(frm, text="Browse", command=self._browse).grid(row=5, column=2, **pad)

        self.prog = ttk.Progressbar(frm, maximum=100)
        self.prog.grid(row=6, column=0, columnspan=3, sticky="ew", padx=12, pady=(12, 4))
        ttk.Label(frm, textvariable=self.status).grid(row=7, column=0, columnspan=3, sticky="w", **pad)

        self.log = tk.Text(frm, height=10, wrap=tk.WORD, state=tk.DISABLED)
        self.log.grid(row=8, column=0, columnspan=3, sticky="nsew", padx=12, pady=6)

        btn = ttk.Frame(frm)
        btn.grid(row=9, column=0, columnspan=3, sticky="e", **pad)
        ttk.Button(btn, text="Render", command=self._start).pack(side=tk.RIGHT)

        frm.columnconfigure(1, weight=1)
        frm.rowconfigure(1, weight=1)
        frm.rowconfigure(8, weight=1)

    def _book(self) -> Book | None:
        i = self.book_cb.current()
        if i < 0 or i >= len(self.books):
            return None
        return self.books[i]

    def _fill_chapters(self) -> None:
        self.chap_list.delete(0, tk.END)
        b = self._book()
        if not b:
            return
        for ch in b.chapters:
            self.chap_list.insert(tk.END, f"{ch.index:02d}  {ch.title}  ({ch.duration:.0f}s)")
        if b.chapters:
            self.chap_list.selection_set(0)

    def _browse(self) -> None:
        d = filedialog.askdirectory(initialdir=self.out_dir.get() or str(REPO))
        if d:
            self.out_dir.set(d)

    def _append_log(self, line: str) -> None:
        self.log.configure(state=tk.NORMAL)
        self.log.insert(tk.END, line + "\n")
        self.log.see(tk.END)
        self.log.configure(state=tk.DISABLED)

    def _start(self) -> None:
        if self.busy:
            return
        book = self._book()
        if not book:
            messagebox.showerror("No book", "No books found under public/books.")
            return
        sel = list(self.chap_list.curselection())
        if not sel:
            messagebox.showerror("No chapter", "Select one or more chapters.")
            return
        try:
            ffmpeg_bin()
        except RuntimeError as e:
            messagebox.showerror("ffmpeg", str(e))
            return
        try:
            lead = float(self.lead.get())
        except ValueError:
            messagebox.showerror("Lead", "Text lead must be a number (seconds).")
            return
        out_dir = Path(self.out_dir.get())
        preset = self.preset.get()
        theme = self.theme.get()
        chapters = [book.chapters[i] for i in sel]
        self.busy = True
        self.prog["value"] = 0
        threading.Thread(
            target=self._run,
            args=(book, chapters, out_dir, preset, theme, lead),
            daemon=True,
        ).start()

    def _run(self, book, chapters, out_dir: Path, preset: str, theme: str, lead: float) -> None:
        n = len(chapters)
        try:
            for ci, ch in enumerate(chapters):
                name = output_name(book.title, ch, preset)
                dest = out_dir / name

                def prog(msg: str, frac: float, ci=ci, n=n) -> None:
                    overall = (ci + frac) / n * 100
                    self.after(0, lambda: self._tick(f"[{ci + 1}/{n}] {msg}", overall))

                self.after(0, lambda c=ch: self._append_log(f"Render {c.title}…"))
                render_chapter(
                    book.title,
                    ch,
                    dest,
                    preset=preset,
                    theme=theme,
                    lead=lead,
                    progress=prog,
                )
                self.after(0, lambda d=dest: self._append_log(f"OK {d}"))
            self.after(0, lambda: self._done(True, f"Done — {n} file(s) in {out_dir}"))
        except Exception as e:
            err = "".join(traceback.format_exception(e))
            self.after(0, lambda: self._append_log(err))
            self.after(0, lambda: self._done(False, str(e)))

    def _tick(self, msg: str, pct: float) -> None:
        self.status.set(msg)
        self.prog["value"] = pct

    def _done(self, ok: bool, msg: str) -> None:
        self.busy = False
        self.status.set(msg)
        self.prog["value"] = 100 if ok else 0
        if ok:
            messagebox.showinfo("Done", msg)
        else:
            messagebox.showerror("Render failed", msg)


def main() -> None:
    if not scan_books():
        print("No books in public/books", file=sys.stderr)
    App().mainloop()


if __name__ == "__main__":
    main()
