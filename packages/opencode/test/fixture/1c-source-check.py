"""Exercise the shipped Python tools, only in a disposable directory (no 1C platform)."""
import json
import os
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path
from lxml import etree

ROOT = Path(__file__).resolve().parents[4]
SKILLS = ROOT / "gamma-agent-market/bundles/1c-development/skills"


def run(skill, script, *args, success=True):
    result = subprocess.run(
        [sys.executable, str(SKILLS / skill / "scripts" / script), *map(str, args)],
        capture_output=True, text=True,
    )
    print(f"{skill}/{script}: exit={result.returncode}\n{result.stdout}{result.stderr}")
    if success:
        assert result.returncode == 0, result.stderr + result.stdout
    return result


with tempfile.TemporaryDirectory(prefix="gamma-1c-sources-test-") as temporary:
    work = Path(temporary)
    project = work / "project"
    shutil.copytree(Path(__file__).parent / "1c-project", project)
    index = work / "index.json"
    run("1c-config-index", "config-index.py", "-ConfigPath", project, "-OutFile", index)
    contents = index.read_text()
    assert "Товары" in contents and "Приветствие" in contents
    definition = work / "object.json"
    definition.write_text(json.dumps({"type": "Catalog", "name": "Партнеры", "attributes": ["ИНН: String(12)"]}, ensure_ascii=False))
    run("1c-meta-compile", "meta-compile.py", "-JsonPath", definition, "-OutputDir", project)
    obj = project / "Catalogs/Партнеры.xml"
    before = etree.parse(str(obj)).xpath("//@uuid")
    run("1c-meta-edit", "meta-edit.py", "-ObjectPath", obj, "-Operation", "add-attribute", "-Value", "Телефон: String(20)")
    after = etree.parse(str(obj)).xpath("//@uuid")
    assert set(before).issubset(set(after)), "Existing UUIDs must survive editing"
    assert "Телефон" in obj.read_text(encoding="utf-8-sig")
    run("1c-meta-validate", "meta-validate.py", "-ObjectPath", obj)
    module = project / "CommonModules/ОбщиеФункции/Ext/Module.bsl"
    module.write_text(module.read_text() + '\nПроцедура НоваяПроцедура() Экспорт\n    Сообщить("Готово");\nКонецПроцедуры\n')
    result = run("bsp", "bsp_api.py", "method", "НоваяПроцедура", "--src", project, "--module", "ОбщиеФункции")
    assert "НоваяПроцедура" in result.stdout and "Module.bsl" in result.stdout
    references = SKILLS / "bsp/references"
    assert any("СообщитьПользователю" in file.read_text() for file in references.glob("*.md"))
    review = run("1c-bsl-validate", "bsl-validate.py", "-ModulePath", module, "-IndexPath", index, "-Catalog", "-Json", success=False)
    assert review.returncode == 1 and "CLIENT-04" in review.stdout
    module.write_text(module.read_text().replace('    Сообщить(Текст);', '').replace('    Сообщить("Готово");', ''))
    run("1c-bsl-validate", "bsl-validate.py", "-ModulePath", module, "-IndexPath", index, "-Catalog", "-Json")
    assert "gamma-bsl_analyze_file" in (SKILLS / "1c-code-review/SKILL.md").read_text()
    environment = subprocess.run(
        [sys.executable, str(SKILLS / "1c-environment/scripts/check.py")],
        env={**os.environ, "GAMMA_1C_PLATFORM": str(work / "missing-platform")},
        capture_output=True, text=True, check=True,
    )
    assert json.loads(environment.stdout)["mode"] == "source_only"
    assert json.loads(environment.stdout)["platform"]["executable"] is None
    invalid = work / "broken.xml"
    invalid.write_text("<MetaDataObject><Catalog></MetaDataObject>")
    assert run("1c-meta-validate", "meta-validate.py", "-ObjectPath", invalid, success=False).returncode != 0
    form = work / "Form/Ext/Form.xml"
    form.parent.mkdir(parents=True)
    run("1c-form-compile", "form-compile.py", "-FromObject", "-ObjectPath", obj, "-OutputPath", form)
    run("1c-form-validate", "form-validate.py", "-FormPath", form)
    extension = work / "extension"
    run("1c-cfe-init", "cfe-init.py", "-Name", "GammaExtension", "-NamePrefix", "Гамма_", "-OutputDir", extension, "-ConfigPath", project)
    run("1c-cfe-validate", "cfe-validate.py", "-ExtensionPath", extension, "-ConfigPath", project)
    external = work / "external"
    run("1c-epf-scaffold", "init.py", "-Name", "GammaProcessing", "-SrcDir", external)
    run("1c-epf-validate", "epf-validate.py", "-ObjectPath", external / "GammaProcessing.xml")
    report = work / "report"
    run("1c-erf-init", "init.py", "-Name", "GammaReport", "-SrcDir", report, "-WithSKD")
    skd = work / "Template.xml"
    run("1c-skd-compile", "skd-compile.py", "-Value", json.dumps({"dataSets": [{"query": "ВЫБРАТЬ Товары.Наименование КАК Наименование ИЗ Справочник.Товары КАК Товары", "fields": ["Наименование"]}]}, ensure_ascii=False), "-OutputPath", skd)
    run("1c-skd-validate", "skd-validate.py", "-TemplatePath", skd)
    for xml in work.rglob("*.xml"):
        if xml.is_file() and xml != invalid:
            etree.parse(str(xml))
    print("PASS: index, metadata create/edit/UUIDs, BSL method lookup, BSP resources, static review, malformed XML rejection, forms, extensions, external processing/report scaffolds")
