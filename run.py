import sys
from pathlib import Path
packages=Path(__file__).parent/'.python-packages'
if packages.exists(): sys.path.insert(0,str(packages))
if __name__=='__main__':
 import os
 from backend.config import ROOT
 import uvicorn
 uvicorn.run('backend.main:app',host=os.getenv('HOST','127.0.0.1'),port=int(os.getenv('PORT','8000')))
