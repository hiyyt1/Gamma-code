import { expect, test } from "bun:test"

// Opt in to external prerequisites; absence must not masquerade as a passed check.
const python = process.env.GAMMA_1C_PYTHON
;(python ? test : test.skip)(
  "shipped 1C Python generators and validators execute on disposable sources",
  async () => {
    const process = Bun.spawn([python!, `${import.meta.dir}/../fixture/1c-source-check.py`], {
      stdout: "pipe",
      stderr: "pipe",
    })
    const [output, error, code] = await Promise.all([
      new Response(process.stdout).text(),
      new Response(process.stderr).text(),
      process.exited,
    ])
    expect({ code, error, output }).toMatchObject({ code: 0, error: "" })
    expect(output).toContain("PASS: index")
  },
  120_000,
)
