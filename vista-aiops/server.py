from fastapi import FastAPI
from pydantic import BaseModel

from agents.diagnostic_agent import DiagnosticAgent
from agents.troubleshooting_agent import TroubleshootingAgent
from agents.fix_agent import FixAgent

app = FastAPI()

diagnostic_agent = DiagnosticAgent()
troubleshooting_agent = TroubleshootingAgent()
fix_agent = FixAgent()


class LogRequest(BaseModel):
    log: str


@app.get("/")
def root():

    return {
        "status": "ok",
        "project": "vista-aiops"
    }


@app.post("/diagnose")
def diagnose(request: LogRequest):

    result = diagnostic_agent.analyze(
        request.log
    )

    return {

    "status": "success",
    "diagnostic": {
        "cause": result.get("cause"),
        "correction": result.get("correction")
    }

    }



@app.post("/troubleshoot")
def troubleshoot(request: LogRequest):

    diagnostic = diagnostic_agent.analyze(
        request.log
    )

    solutions = troubleshooting_agent.suggest(
        diagnostic
    )

    return {
        "diagnostic": diagnostic,
        "solutions": solutions
    }


@app.post("/fix")
def fix(request: LogRequest):

    diagnostic = diagnostic_agent.analyze(
        request.log
    )

    patch = fix_agent.generate_patch(
        diagnostic
    )

    return {
        "diagnostic": diagnostic,
        "patch": patch
    }
