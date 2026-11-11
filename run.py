import sys
from pathlib import Path
packages=Path(__file__).parent/'.python-packages'
if packages.exists(): sys.path.insert(0,str(packages))
if __name__=='__main__':
 import uvicorn
 uvicorn.run('backend.main:app',host='127.0.0.1',port=8000)
